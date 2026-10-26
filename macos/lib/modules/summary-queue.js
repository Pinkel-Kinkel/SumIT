'use strict';
// Port of src/SummaryQueue.cs

const fs = require('fs');
const path = require('path');
const { Str, Bool, Int, Trunc, Mutex, fileExists, dirExists, listDirs, mkdirp, readText, writeText, nativeRel } = require('../util');
const C = require('../constants');

module.exports = {
  init(host) {
    host.summariesRecovered = false;
    host.summaryWorkOverride = null; // Offline lifecycle regression seam.
    host.summaryGate = new Mutex();
    host.printGate = new Mutex();
    host.aiGate = new Mutex();
    host.summaryQueued = new Set();
    host.summaryRunning = host.summaryRunning || new Set();
    host.summaryProgress = host.summaryProgress || new Map();
  },
  methods: {
    PendingSummary(course, num) {
      return path.join(this.CourseDir(course), C.SumitDir, 'pending-summary-' + num + '.json');
    },
    SavePendingSummary(course, num, title, force, running = false) {
      const file = this.PendingSummary(course, num);
      mkdirp(path.dirname(file));
      const temp = file + '.tmp';
      writeText(temp, JSON.stringify({ course, num, title, force: !!force, running: !!running }));
      fs.renameSync(temp, file);
    },
    async LecturePdfAsync(course, num, title, open = false, force = false) {
      const key = course + '|' + num;
      if (this.shuttingDown || num < 1 || num > 200 || this.summaryQueued.has(key)) return null;
      this.summaryQueued.add(key);
      try {
        this.SavePendingSummary(course, num, title, force);
      } catch (ex) {
        this.summaryQueued.delete(key);
        this.SectionStatus(course, num, ex.message || String(ex), false, true);
        return { Error: true, Text: ex.message || String(ex) };
      }
      this.SectionStatus(course, num, 'בתור להכנת סיכום — העבודה נשמרה', true, false);
      await this.summaryGate.wait();
      const page = this.StudyPagePath(course, num);
      const backup = page + '.previous';
      const partial = page + '.interrupted';
      const digest = path.join(this.CourseDir(course), nativeRel(this.DigestRel(num)));
      const hadPage = fileExists(page);
      const hadDigest = fileExists(digest);
      let success = false;
      const oldDigest = hadDigest ? readText(digest) : null;
      try {
        if (this.shuttingDown) return null;
        if (hadPage) fs.copyFileSync(page, backup);
        if (hadDigest) fs.copyFileSync(digest, digest + '.previous');
        this.SavePendingSummary(course, num, title, force, true);
        const pdf = this.LecturePdfPath(course, num);
        if (fileExists(pdf)) fs.copyFileSync(pdf, pdf + '.previous');
        const result = this.summaryWorkOverride
          ? await this.summaryWorkOverride(course, num)
          : await this.LecturePdfCoreAsync(course, num, title, open, force);
        success = !this.shuttingDown && (!result || !result.Error) && fileExists(page);
        if (!this.shuttingDown && fileExists(this.PendingSummary(course, num))) {
          try { fs.unlinkSync(this.PendingSummary(course, num)); } catch { }
        }
        return result;
      } catch (ex) {
        const msg = ex && ex.message ? ex.message : String(ex);
        if (!this.shuttingDown) this.SectionStatus(course, num, 'הסיכום לא הושלם; אפשר לנסות שוב: ' + Trunc(msg, 120), false, true);
        return { Error: true, Text: msg };
      } finally {
        if (!success) {
          const pdf = this.LecturePdfPath(course, num);
          if (fileExists(pdf + '.previous')) { try { fs.copyFileSync(pdf + '.previous', pdf); } catch { } }
          if (fileExists(page)) { try { fs.copyFileSync(page, partial); } catch { } }
          if (fileExists(backup)) { try { fs.copyFileSync(backup, page); } catch { } }
          else if (!hadPage && fileExists(page)) { try { fs.unlinkSync(page); } catch { } }
          if (hadDigest && oldDigest !== null) { try { writeText(digest, oldDigest); } catch { } }
          else if (fileExists(digest)) { try { fs.unlinkSync(digest); } catch { } }
        }
        if (success && fileExists(backup)) { try { fs.unlinkSync(backup); } catch { } }
        this.summaryQueued.delete(key);
        this.summaryRunning.delete(key);
        this.summaryProgress.delete(key);
        this.summaryGate.release();
      }
    },
    async RecoverSummaries() {
      if (this.summariesRecovered || this.shuttingDown || !dirExists(this.StudyRoot)) return;
      if (!this.AiReadyOrSay(() => { })) return;
      this.summariesRecovered = true;
      for (const courseDir of listDirs(this.StudyRoot)) {
        const metadata = path.join(courseDir, C.SumitDir);
        if (!dirExists(metadata)) continue;
        let files = [];
        try { files = fs.readdirSync(metadata).filter(n => /^pending-summary-.*\.json$/.test(n)).map(n => path.join(metadata, n)); } catch { }
        for (const file of files) {
          try {
            const job = JSON.parse(readText(file));
            const course = Str(job, 'course');
            const num = Int(job, 'num');
            if (path.resolve(file).toLowerCase() !== path.resolve(this.PendingSummary(course, num)).toLowerCase()) continue;
            if (this.summaryQueued.has(course + '|' + num)) continue;
            const page = this.StudyPagePath(course, num);
            if (Bool(job, 'running')) {
              const pdf = this.LecturePdfPath(course, num);
              if (fileExists(pdf + '.previous')) fs.copyFileSync(pdf + '.previous', pdf);
              const digest = path.join(this.CourseDir(course), nativeRel(this.DigestRel(num)));
              if (fileExists(digest + '.previous')) fs.copyFileSync(digest + '.previous', digest);
              else if (fileExists(digest)) fs.unlinkSync(digest);
              if (fileExists(page + '.previous')) fs.copyFileSync(page + '.previous', page);
              else if (fileExists(page)) { fs.copyFileSync(page, page + '.interrupted'); fs.unlinkSync(page); }
            }
            await this.LecturePdfAsync(course, num, Str(job, 'title'), false, Bool(job, 'force'));
          } catch (ex) {
            if (!this.shuttingDown) this.Toast('לא ניתן לשחזר סיכום: ' + Trunc(ex && ex.message ? ex.message : String(ex), 100), true);
          }
          if (this.shuttingDown) return;
        }
      }
    },
  },
};
