'use strict';
// Port of src/Lectures.cs

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { nativeImage } = require('electron');
const { Str, Int, SafeName, IsInside, sha256B64, fileExists, dirExists, listFiles, mkdirp, nativeRel } = require('../util');
const platform = require('../platform');
const C = require('../constants');
const { WebView } = require('../webview');

function IsPortalPage(url) {
  try {
    const u = new URL(url || '');
    return u.hostname.toLowerCase() === 'portal.hit.ac.il' || u.hostname.toLowerCase() === 'webrashim.hit.ac.il';
  } catch { return false; }
}

function UniquePathIn(dir, name) {
  let p = path.join(dir, name);
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 2; fileExists(p); i++) {
    p = path.join(dir, base + ' (' + i + ')' + ext);
  }
  return p;
}

function DataUrlOf(file) {
  try { return fileExists(file) ? 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') : ''; }
  catch { return ''; }
}

function ImageToJpegBytesPath(source, target, w, h) {
  const img = nativeImage.createFromPath(source);
  if (img.isEmpty()) throw new Error('קובץ תמונה לא תקין');
  const size = img.getSize();
  const scale = Math.max(w / size.width, h / size.height);
  const sw = Math.ceil(size.width * scale), sh = Math.ceil(size.height * scale);
  const resized = img.resize({ width: sw, height: sh, quality: 'best' });
  const cropped = resized.crop({ x: Math.max(0, Math.floor((sw - w) / 2)), y: Math.max(0, Math.floor((sh - h) / 2)), width: w, height: h });
  mkdirp(path.dirname(target));
  fs.writeFileSync(target, cropped.toJPEG(90));
  return target;
}

function isValidIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

module.exports = {
  init(host) {
    host.approvedDownloadOrigins = new Set();
    host.DownloadPermissionPrompt = null;
    host.popupView = null;
  },
  methods: {
    IsPortalPage,
    UniquePathIn,
    DataUrlOf,
    ImageToJpegBytesPath,

    SaveLectureCalendar(course, message) {
      const first = Str(message, 'first');
      const holidays = Str(message, 'holidays').split(/[, \r\n]+/).filter(Boolean);
      for (const value of holidays.concat(first ? [first] : [])) {
        if (!isValidIsoDate(value)) {
          this.Toast('הזן תאריכים בפורמט YYYY-MM-DD', true);
          return;
        }
      }
      const meta = this.LoadMeta(course);
      meta.lectureCalendar = { first, holidays };
      this.SaveMeta(course, meta);
      this.SendCourseLocal(course);
    },

    LectureFingerprint(course, num) {
      const files = [];
      for (let i = 1; i <= num; i++) {
        const dir = this.LectureDir(course, i);
        if (dirExists(dir)) {
          for (const f of listFiles(dir, true)) {
            if (!f.includes(path.sep + C.PointersFolder + path.sep) && !this.IsSummaryFile(f) && path.extname(f).toLowerCase() !== '.mp4') {
              files.push(f);
            }
          }
        }
      }
      files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      let source = 'lecture-v2|';
      for (const file of files) {
        try { source += file + sha256B64(fs.readFileSync(file)); } catch { }
      }
      return sha256B64(Buffer.from(source, 'utf8'));
    },

    SafeDownloadFolder(folder) {
      folder = folder || '';
      const parts = folder.replace(/\\/g, '/').split('/').filter(Boolean);
      if ((parts.length === 2 || parts.length === 3) && parts[0] === 'הרצאות' && parts[1].startsWith('הרצאה ')) {
        const number = parseInt(parts[1].substring(6), 10);
        if (!isNaN(number) && number > 0 && number <= 200) {
          if (parts.length === 3 && (parts[2] === C.Exercises || parts[2] === C.LecturerNotes || parts[2] === C.Notebook)) {
            return path.join(this.LectureFolderName(number), parts[2]);
          }
          if (parts.length === 2) return this.LectureFolderName(number);
        }
      }
      return SafeName(folder.length > 0 ? folder : C.Exams);
    },

    MigrateOldSummary(course, num) {
      try {
        const dir = this.LectureDir(course, num);
        const oldHtml = path.join(dir, C.SummaryName + '.html');
        const oldPdf = path.join(dir, C.SummaryName + '.pdf');
        const oldDigest = path.join(dir, '.תקציר.md');
        const oldPrint = path.join(dir, '.summary-fingerprint');
        if (!fileExists(oldHtml) && !fileExists(oldPdf) && !fileExists(oldDigest) && !fileExists(oldPrint)) return;
        const move = (from, to) => {
          if (!fileExists(from) || fileExists(to)) return;
          mkdirp(path.dirname(to));
          fs.renameSync(from, to);
        };
        move(oldHtml, this.StudyPagePath(course, num));
        move(oldPdf, this.LecturePdfPath(course, num));
        move(oldDigest, path.join(this.CourseDir(course), nativeRel(this.DigestRel(num))));
        move(oldPrint, path.join(this.CourseDir(course), C.SumitDir, 'fingerprints', num + '.txt'));
        this.HideSumit(course);
      } catch { }
    },

    ManualLectures(course) {
      const meta = this.LoadMeta(course);
      const rows = Array.isArray(meta.lectures) ? meta.lectures.filter(x => x && typeof x === 'object') : [];
      for (const r of rows) this.MigrateOldSummary(course, Int(r, 'num'));
      return rows
        .slice()
        .sort((a, b) => Int(a, 'num') - Int(b, 'num'))
        .map(x => {
          const n = Int(x, 'num');
          const key = course + '|' + n;
          return {
            num: n,
            title: Str(x, 'title'),
            date: Str(x, 'date'),
            summaryNotes: this.SummaryNotes(course, n),
            due: Str(x, 'due'),
            items: [],
            local: this.LocalInfo(course, n),
            running: this.summaryRunning.has(key) || this.summaryQueued.has(key),
            progress: this.summaryProgress.has(key) ? this.summaryProgress.get(key) : null,
          };
        });
    },

    SaveLecture(course, message) {
      const num = Int(message, 'num');
      if (!course || !course.trim() || num < 1 || num > 200) {
        this.Toast('בחר מספר הרצאה בין 1 ל-200', true);
        return;
      }
      for (const field of ['date', 'due']) {
        const value = Str(message, field);
        if (value.length > 0 && !isValidIsoDate(value)) {
          this.Toast('תאריך לא תקין', true);
          return;
        }
      }
      const meta = this.LoadMeta(course);
      const rows = Array.isArray(meta.lectures) ? meta.lectures : [];
      let row = rows.find(x => x && Int(x, 'num') === num);
      if (!row) { row = {}; rows.push(row); }
      row.num = num;
      row.title = Str(message, 'title').trim().length > 0 ? Str(message, 'title').trim() : 'הרצאה ' + num;
      row.date = Str(message, 'date');
      row.due = Str(message, 'due');
      meta.lectures = rows;
      meta.setupDone = true;
      for (const sub of [C.LecturerNotes, C.Notebook, C.Exercises, C.RecordingFolder]) {
        mkdirp(path.join(this.LectureDir(course, num), sub));
      }
      this.SaveMeta(course, meta);
      this.SendCourseLocal(course);
    },

    OpenSitePopup(opener, details) {
      const url = (details && details.url) || '';
      if (opener && IsPortalPage(opener.source)) {
        this.OpenRealPopup(url);
        return { action: 'deny' };
      }
      try {
        const u = new URL(url);
        if (opener && (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'blob:')) {
          opener.navigate(url);
        }
      } catch { }
      return { action: 'deny' };
    },

    CloseSitePopup() {
      const pv = this.popupView;
      this.popupView = null;
      if (!pv) return;
      try { this.removePanel('popup'); pv.destroy(); } catch { }
    },

    OpenRealPopup(url) {
      try {
        this.CloseSitePopup();
        const view = new WebView('popup', { session: this.browserSession });
        this.popupView = view;
        view.setDevTools(false);
        view.wc.setWindowOpenHandler((d) => this.OpenSitePopup(view, d));
        const onNav = () => {
          if (this.popupView === view) {
            this.Send({ type: 'siteNav', url: view.source, canBack: view.canGoBack, canForward: view.canGoForward });
          }
        };
        view.wc.on('did-navigate', onNav);
        view.wc.on('did-navigate-in-page', onNav);
        view.wc.on('did-start-loading', () => this.Send({ type: 'siteLoading', loading: true }));
        view.wc.on('did-stop-loading', () => this.Send({ type: 'siteLoading', loading: false }));
        view.wc.on('destroyed', () => { if (this.popupView === view) this.CloseSitePopup(); });
        this.addPanel('popup', [[view, (w, h) => this.siteRect(w, h)]], true, true);
        this.bringToFront('popup');
        if (url && url !== 'about:blank') view.navigate(url);
      } catch { this.CloseSitePopup(); }
    },

    // Returns { dir, where } (C# had `out string where`).
    SiteSaveDir(name) {
      const course = this.siteDownloadCourse;
      const ac = this.ActiveSiteCore();
      try {
        if (!course && ac && ac.source) {
          const au = new URL(ac.source);
          if (au.hostname.toLowerCase().includes('webrashim.hit.ac.il')) {
            return { dir: path.join(this.AppRoot, C.TimetableFolder), where: 'מערכת שעות' };
          }
        }
      } catch { }
      if (!course) return { dir: path.join(this.AppRoot, 'הורדות'), where: 'הורדות' };
      const rel = this.SafeDownloadFolder(this.siteDownloadFolder);
      let dir = path.join(this.CourseDir(course), rel);
      const lecturesRoot = path.join(this.CourseDir(course), 'הרצאות') + path.sep;
      if (dir.toLowerCase().startsWith(lecturesRoot.toLowerCase()) && !dir.substring(lecturesRoot.length).includes(path.sep)) {
        dir = this.LectureSubdir(dir, '', name);
      }
      const tail = dir.substring(this.CourseDir(course).length)
        .replace(/^[\\/]+|[\\/]+$/g, '')
        .replace(/^הרצאות[\\/]/, '')
        .split(/[\\/]/).join(' › ');
      return { dir, where: course + ' › ' + tail };
    },

    async SavePageAsPdf() {
      const c = this.ActiveSiteCore();
      if (!c) return;
      try {
        const rawTitle = c.wc.getTitle ? c.wc.getTitle() : '';
        const title = SafeName(!rawTitle || !rawTitle.trim() ? 'דף מהאתר' : rawTitle);
        const { dir, where } = this.SiteSaveDir(title + '.pdf');
        mkdirp(dir);
        const outPath = UniquePathIn(dir, title + '.pdf');
        const shown = path.basename(outPath);
        this.Send({ type: 'siteDownload', name: shown, dir, state: 'started', where });
        const ok = await c.printToPdf(outPath, { printBackground: true, displayHeaderFooter: false });
        if (!ok || !fileExists(outPath)) {
          this.Send({ type: 'siteDownload', name: shown, state: 'failed' });
          return;
        }
        this.Send({ type: 'siteDownload', name: shown, dir, path: outPath, state: 'done', where });
        if (this.siteDownloadCourse) this.SendCourseLocal(this.siteDownloadCourse);
      } catch (ex) {
        this.Toast('לא הצלחתי לשמור כ-PDF: ' + (ex.message || String(ex)), true);
      }
    },

    ShowFile(m) {
      const p = Str(m, 'path');
      if (p.length === 0) return;
      const full = path.resolve(p), ext = path.extname(full).toLowerCase();
      if (!(IsInside(full, this.StudyRoot) || IsInside(full, this.AppRoot)) || !fileExists(full) || (ext !== '.html' && ext !== '.pdf')) return;
      if (ext === '.html') this.PrepareStudyPage(full);
      this.PlaceSite(m);
      this.site.navigate(pathToFileURL(full).href);
      this.setPanelVisible('site', true);
      this.bringToFront('site');
    },

    SkipExams(course) {
      const meta = this.LoadMeta(course);
      meta.examsSkipped = true;
      this.SaveMeta(course, meta);
      this.SendCourseLocal(course);
    },

    get ProfileImageFile() { return path.join(platform.DataRoot, 'profile.jpg'); },
    ProfileImage() { return DataUrlOf(this.ProfileImageFile); },

    async PickImage(title) {
      const files = await this.pickFiles(title, [{ name: 'תמונות', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }], false);
      return files.length > 0 ? files[0] : null;
    },

    async SetProfileImage(clear) {
      try {
        if (clear) {
          if (fileExists(this.ProfileImageFile)) fs.unlinkSync(this.ProfileImageFile);
        } else {
          const f = await this.PickImage('בחר תמונה אישית');
          if (!f) return;
          ImageToJpegBytesPath(f, this.ProfileImageFile, 256, 256);
        }
        this.SendSettings();
      } catch (ex) {
        this.Toast('לא הצלחתי לטעון את התמונה: ' + (ex.message || String(ex)), true);
      }
    },

    BackgroundFile(course) { return path.join(this.CourseDir(course), C.SumitDir, 'background.jpg'); },

    BackgroundFor(course) {
      const meta = this.LoadMeta(course);
      const img = DataUrlOf(this.BackgroundFile(course));
      if (img.length > 0) return img;
      const c = Str(meta, 'bgColor');
      return /^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}$/.test(c) ? c : '';
    },

    async SetCourseBackground(course, mode, colors) {
      try {
        const meta = this.LoadMeta(course);
        if (mode === 'image') {
          const f = await this.PickImage('בחר תמונת רקע לקורס');
          if (!f) return;
          ImageToJpegBytesPath(f, this.BackgroundFile(course), 900, 240);
          delete meta.bgColor;
        } else {
          if (fileExists(this.BackgroundFile(course))) fs.unlinkSync(this.BackgroundFile(course));
          if (mode === 'color' && /^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}$/.test(colors || '')) meta.bgColor = colors;
          else delete meta.bgColor;
        }
        this.SaveMeta(course, meta);
        this.HideSumit(course);
        this.SendCourseLocal(course);
        if (this.lastCourses) {
          for (const cc of this.lastCourses) if (Str(cc, 'name') === course) cc.local = this.CourseLocal(course);
          this.Send({ type: 'courses', data: this.lastCourses });
        }
      } catch (ex) {
        this.Toast('לא הצלחתי לשנות את הרקע: ' + (ex.message || String(ex)), true);
      }
    },

    HideSumit(_course) {
      // On macOS, a folder named `.sumit` is already hidden in Finder by its leading dot.
    },
  },
};
