'use strict';
// Port of src/Cs24.cs

const fs = require('fs');
const path = require('path');
const { Str, Bool, SafeName, Trunc, Loose, IsInside, Mutex, delay, fileExists, mkdirp } = require('../util');
const C = require('../constants');

function EditDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

function Cs24Match(course, folder) {
  const stop = new Set(['בזום', 'למהנדסים', 'מהנדסים', 'קורס', 'hit']);
  const words = (s) => Loose(s).split(' ').filter(w => w.length > 0 && !stop.has(w));
  const c = words(course);
  const f = words(folder);
  if (f.length === 0) return 0;
  let hit = 0;
  for (const w of f) {
    if (c.includes(w)) { hit++; continue; }
    if (w.length >= 4 && c.some(x => x.length >= 4 && EditDistance(x, w) <= 1)) { hit++; continue; }
    return 0;
  }
  return hit * 10 - Math.abs(c.length - f.length);
}

module.exports = {
  init(host) {
    host.cs24Running = new Set();
    host.cs24Lock = new Mutex();
    host.progressRange = new Map();
  },
  methods: {
    Cs24Match,
    EditDistance,

    async Cs24Open(url) {
      const domReady = new Promise((resolve) => {
        const done = () => { this.cs24View.wc.removeListener('dom-ready', done); resolve(); };
        this.cs24View.wc.on('dom-ready', done);
      });
      this.cs24View.navigate(url);
      await Promise.race([domReady, delay(6000)]);
      const tail = JSON.stringify(url.substring(C.Cs24Base.length));
      try {
        await this.EvalAsync(this.cs24View, `
          const match = () => location.href.includes(${tail}) && !!document.querySelector('a[href^="/drive?"], iframe[src*="assets.cs24.co.il"], embed[src*="assets.cs24.co.il"], img[src*="assets.cs24.co.il"], video[src*="assets.cs24.co.il"]');
          if (match()) return true;
          return await new Promise((resolve) => {
            const t = setTimeout(() => { obs.disconnect(); resolve(false); }, 8000);
            const obs = new MutationObserver(() => {
              if (match()) { clearTimeout(t); obs.disconnect(); resolve(true); }
            });
            obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
          });
        `, 9000);
      } catch { }
      return url;
    },

    async Cs24List(url) {
      await this.Cs24Open(url);
      const v = await this.EvalAsync(this.cs24View, `
const clean = (t) => (t || '').replace(/הוסף למועדפים|סמן כהושלם/g, '').replace(/\\s+/g, ' ')
  .replace(/\\s*\\d{1,2}\\s+ב?[\\u0590-\\u05ff]+\\s+\\d{4}.*$/, '')
  .replace(/[\\s\\-–·]+$/, '').trim();
return [...document.querySelectorAll('a[href^="/drive?d="], a[href^="/drive?f="]')]
  .filter(a => !a.closest('header, nav, footer') && clean(a.innerText))
  .map(a => ({ name: clean(a.innerText), href: a.getAttribute('href'), folder: a.getAttribute('href').startsWith('/drive?d=') }));`, 15000);
      const raw = JSON.parse(v) || [];
      const seen = new Set();
      const out = [];
      for (const e of raw) {
        const href = C.Cs24Base + Str(e, 'href');
        if (href === url || seen.has(href)) continue;
        seen.add(href);
        out.push({ Name: Str(e, 'name'), Href: href, Folder: Bool(e, 'folder') });
      }
      return out;
    },

    async Cs24FindCourse(course) {
      let root = Str(this.settings, 'cs24Root');
      if (root.length === 0) root = C.Cs24DefaultRoot;
      const entries = (await this.Cs24List(root)).filter(e => e.Folder)
        .map(e => ({ e, s: Cs24Match(course, e.Name) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s);
      return entries.length > 0 ? entries[0].e : null;
    },

    async Cs24FileUrl(filePage) {
      await this.Cs24Open(filePage);
      const v = await this.EvalAsync(this.cs24View, `
const f = document.querySelector('iframe[src*="assets.cs24.co.il"], embed[src*="assets.cs24.co.il"], img[src*="assets.cs24.co.il"], a[href*="assets.cs24.co.il"], video[src*="assets.cs24.co.il"]');
return f ? (f.getAttribute('src') || f.getAttribute('href')) : '';`, 8000);
      const url = JSON.parse(v);
      try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname.toLowerCase() === 'assets.cs24.co.il' ? u.href : null;
      } catch { return null; }
    },

    Progress(course, text, fraction) {
      const r = this.progressRange.get(course) || [0.0, 1.0];
      const clamped = Math.max(0, Math.min(1, fraction));
      const pct = Math.round(100 * (r[0] + (r[1] - r[0]) * clamped));
      this.Send({ type: 'courseStatus', course, busy: true, text, pct, setup: this.progressRange.has(course) });
    },

    async Cs24SyncCourse(course) {
      if (this.cs24Running.has(course)) return 0;
      this.cs24Running.add(course);
      let saved = 0;
      let locked = false;
      try {
        if (this.cs24Lock.locked) this.Progress(course, 'מחכה לתורו ב-CS24 (קורס אחר מוריד משם עכשיו)...', 0);
        await this.cs24Lock.wait();
        locked = true;
        this.Progress(course, 'מחפש את הקורס ב-CS24...', 0);
        const folder = await this.Cs24FindCourse(course);
        if (!folder) {
          this.Send({ type: 'courseStatus', course, busy: false, text: 'לא מצאתי את הקורס ב-CS24. אפשר להוריד ידנית מהלשונית CS24 בצד.', error: false });
          return 0;
        }
        const meta = this.LoadMeta(course);
        meta.cs24Folder = folder.Href;
        this.SaveMeta(course, meta);

        const files = [];
        const queue = [['', folder, 0]];
        let visited = 0;
        while (queue.length > 0 && files.length < C.Cs24MaxFiles) {
          const [relCur, entry, depth] = queue.shift();
          visited++;
          this.Progress(course, 'בודק מה יש ב-CS24: ' + Trunc(relCur.length > 0 ? relCur : folder.Name, 60), 0.1 * visited / (visited + queue.length + 1));
          for (const e of await this.Cs24List(entry.Href)) {
            const rel = relCur.length > 0 ? path.join(relCur, SafeName(e.Name)) : SafeName(e.Name);
            if (e.Folder) { if (depth < 3) queue.push([rel, e, depth + 1]); }
            else files.push([relCur, e]);
          }
        }

        for (let i = 0; i < files.length; i++) {
          const [relDir, entry] = files[i];
          this.Progress(course, 'מוריד מ-CS24 (' + (i + 1) + ' מתוך ' + files.length + '): ' + Trunc(entry.Name, 50), 0.1 + 0.9 * i / files.length);
          try {
            const asset = await this.Cs24FileUrl(entry.Href);
            if (!asset) continue;
            const exam = /(מבחן|מבחנים|בוחן|בחנים|מועד)/.test(relDir + ' ' + entry.Name);
            const dir = exam ? path.join(this.CourseDir(course), C.Exams, C.Cs24Folder, relDir) : path.join(this.CourseDir(course), C.Cs24Folder, relDir);
            const ext = path.extname(decodeURIComponent(new URL(asset).pathname));
            let name = SafeName(entry.Name);
            if (ext.length > 0 && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
            const destPath = path.join(dir, name);
            if (!IsInside(destPath, this.CourseDir(course))) continue;
            if (fileExists(destPath)) continue;
            mkdirp(dir);
            const resp = await fetch(asset, { headers: { 'User-Agent': 'SumIT/' + C.Version }, signal: AbortSignal.timeout(600000) });
            if (!resp.ok) continue;
            const cl = Number(resp.headers.get('content-length') || 0);
            if (cl > 200 * 1024 * 1024) continue;
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 200 * 1024 * 1024) continue;
            const temp = destPath + '.part';
            fs.writeFileSync(temp, buf);
            fs.renameSync(temp, destPath);
            saved++;
          } catch { }
          await delay(250);
        }
        this.Send({ type: 'courseStatus', course, busy: false, text: saved > 0 ? 'ירדו ' + saved + ' קבצים מ-CS24' : '', error: false });
      } catch (ex) {
        this.Send({ type: 'courseStatus', course, busy: false, text: 'CS24: ' + (ex.message || String(ex)), error: true });
      } finally {
        this.cs24Running.delete(course);
        if (locked) this.cs24Lock.release();
        if (this.cs24View) this.cs24View.navigate('about:blank');
        this.SendCourseLocal(course);
      }
      return saved;
    },

    async Cs24Sync(course) { await this.Cs24SyncCourse(course); },

    async SetupRun(course, sections, cs24) {
      const meta = this.LoadMeta(course);
      meta.setupDone = true;
      this.SaveMeta(course, meta);
      this.Send({ type: 'setupRun', course, busy: true });
      try {
        this.progressRange.set(course, [0.0, cs24 ? 0.3 : 1.0]);
        await this.SyncCourseAsync(course, sections);
        if (cs24) {
          this.progressRange.set(course, [0.3, 1.0]);
          await this.Cs24SyncCourse(course);
        }
      } finally {
        this.progressRange.delete(course);
      }
      this.Send({ type: 'setupRun', course, busy: false });
      this.LearnCourse(course, sections);
    },
  },
};
