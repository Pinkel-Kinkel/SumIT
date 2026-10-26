'use strict';
// Port of src/Notability.cs (adapted to launch Notability.app on macOS via `open -a Notability`).

const fs = require('fs');
const path = require('path');
const { Str, SafeName, Loose, IsInside, Exec, dirExists, fileExists, listDirs, listFiles, mkdirp } = require('../util');
const C = require('../constants');

module.exports = {
  methods: {
    async OpenNotability() {
      // On macOS, Notability from the Mac App Store lives at /Applications/Notability.app.
      const r = await Exec('/usr/bin/open', ['-Ra', 'Notability'], null, 5000);
      if (r.code === 0) {
        await Exec('/usr/bin/open', ['-a', 'Notability'], null, 10000);
        this.Toast('פותח את Notability. מחברת שתייצא ל-PDF לתיקיית "מחברת" של הקורס תיכנס לסיכומים.', false);
        return;
      }
      this.Send({ type: 'openSite', site: 'notability' });
    },
    NotabilitySubjects() {
      const root = this.NotabilityDir;
      if (root.length === 0 || !dirExists(root)) return [];
      return listDirs(root).map(d => path.basename(d)).filter(n => !n.startsWith('.')).sort();
    },
    GuessSubject(course, subjects) {
      const c = Loose(course);
      for (const s of subjects) {
        const l = Loose(s);
        if (l.length >= 2 && (c.includes(l) || l.includes(c))) return s;
      }
      const first = (c.split(' ')[0]) || '';
      return first.length >= 3 ? (subjects.find(s => Loose(s).includes(first)) || null) : null;
    },
    NotabilityInfo(course) {
      const subjects = this.NotabilitySubjects();
      const linked = Str(this.LoadMeta(course), 'notability');
      return {
        configured: this.NotabilityDir.length > 0 && dirExists(this.NotabilityDir),
        linked: linked.length > 0 ? linked : null,
        guess: linked.length > 0 ? null : this.GuessSubject(course, subjects),
        subjects,
        notes: this.CountFiles(path.join(this.CourseDir(course), C.Notebook)),
      };
    },
    SendNotabilityFolders() {
      this.Send({ type: 'notabilitySubjects', subjects: this.NotabilitySubjects() });
    },
    LinkNotability(course, subject) {
      const meta = this.LoadMeta(course);
      if (!subject || subject.length === 0) delete meta.notability;
      else if (this.NotabilitySubjects().includes(subject)) meta.notability = subject;
      else return;
      this.SaveMeta(course, meta);
      const added = this.ImportNotability(course);
      if (added > 0) this.Toast(added + ' דפי מחברת יובאו מ-Notability', false);
      this.SendCourseLocal(course);
    },
    ImportAllNotability() {
      if (this.NotabilityDir.length === 0 || !dirExists(this.NotabilityDir) || !dirExists(this.StudyRoot)) return;
      for (const dir of listDirs(this.StudyRoot)) {
        const course = path.basename(dir);
        if (Str(this.LoadMeta(course), 'notability').length > 0) this.ImportNotability(course);
      }
    },
    ImportNotability(course) {
      const subject = Str(this.LoadMeta(course), 'notability');
      if (subject.length === 0 || this.NotabilityDir.length === 0) return 0;
      const src = path.join(this.NotabilityDir, SafeName(subject));
      if (!dirExists(src) || !IsInside(src, this.NotabilityDir)) return 0;
      const dst = path.join(this.CourseDir(course), C.Notebook);
      let added = 0;
      try {
        for (const f of listFiles(src, true).filter(p => p.toLowerCase().endsWith('.pdf'))) {
          const rel = f.substring(src.length).replace(/^[\\/]+/, '');
          const target = path.join(dst, rel);
          if (fileExists(target) && fs.statSync(target).mtimeMs >= fs.statSync(f).mtimeMs) continue;
          mkdirp(path.dirname(target));
          fs.copyFileSync(f, target);
          added++;
        }
      } catch { }
      return added;
    },
  },
};
