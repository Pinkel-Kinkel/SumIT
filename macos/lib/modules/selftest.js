'use strict';
// Port of src/SelfTest.cs: `electron . --selftest [out.json]` runs the app logic end-to-end and writes a JSON report.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  Str, Bool, Int, SafeName, Trunc, Q, IsInside, Protect, Unprotect, VttToText,
  delay, guidN, fileExists, dirExists, listFiles, mkdirp, readText, writeText,
} = require('../util');
const platform = require('../platform');
const C = require('../constants');

module.exports = {
  methods: {
    async RunSelfTest() {
      const report = {};
      const checks = [];
      const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });

      try {
        // Pure helpers
        check('SafeName strips path parts', SafeName('..\\..\\evil/../x.pdf') === '_.._evil_.._x.pdf', SafeName('..\\..\\evil/../x.pdf'));
        check('SafeName handles dots', SafeName('..') === 'Untitled', SafeName('..'));
        check('SafeName reserved names', SafeName('CON.pdf') === '_CON.pdf', SafeName('CON.pdf'));
        check('Q quotes', Q('a "b" c\\') === '"a \\"b\\" c\\\\"', Q('a "b" c\\'));
        check('IsInside blocks traversal', !IsInside('/Users/test/HIT/Courses/../secret.txt', '/Users/test/HIT/Courses'), null);
        check('IsInside allows children', IsInside('/Users/test/HIT/Courses/a/b.pdf', '/Users/test/HIT/Courses'), null);
        check(
          'Zoom URL check',
          this.IsZoomUrl('https://hit-ac-il.zoom.us/rec/play/abc')
            && !this.IsZoomUrl('https://zoom.us.evil.com/rec/x')
            && !this.IsZoomUrl('http://hit-ac-il.zoom.us/rec/x'),
          null
        );
        check(
          'Moodle URL check',
          this.IsMoodleUrl('https://md.hit.ac.il/mod/resource/view.php?id=1')
            && !this.IsMoodleUrl('https://md.hit.ac.il.evil.com/x'),
          null
        );
        check(
          'Exercise names',
          this.IsExercise('\u05EA\u05E8\u05D2\u05D9\u05DC 3.pdf')
            && this.IsExercise('HW2 solution.pdf')
            && !this.IsExercise('\u05D4\u05E8\u05E6\u05D0\u05D4 3.pdf'),
          null
        );
        check(
          'Exam names',
          this.ExamNameRe().test('\u05DE\u05D1\u05D7\u05DF \u05DE\u05D5\u05E2\u05D3 \u05D0 2023.pdf')
            && this.ExamNameRe().test('Final exam 2022')
            && !this.ExamNameRe().test('\u05D4\u05E8\u05E6\u05D0\u05D4 1'),
          null
        );
        check(
          'Syllabus names',
          this.SyllabusNameRe().test('\u05E1\u05D9\u05DC\u05D1\u05D5\u05E1 \u05D4\u05E7\u05D5\u05E8\u05E1.pdf')
            && this.SyllabusNameRe().test('Syllabus 2025'),
          null
        );
        const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDr. Cohen: \u05E9\u05DC\u05D5\u05DD\n\n2\n00:00:05.000 --> 00:00:08.000\nDr. Cohen: \u05D4\u05D9\u05D5\u05DD \u05E0\u05DC\u05DE\u05D3\n';
        const txt = VttToText(vtt, 'T');
        check('Transcript text', txt.includes('[00:00:01] Dr. Cohen: \u05E9\u05DC\u05D5\u05DD \u05D4\u05D9\u05D5\u05DD \u05E0\u05DC\u05DE\u05D3'), txt.replace(/\n/g, ' | '));
        check('Secrets are encrypted', Unprotect(Protect('abc')) === 'abc' && Protect('abc') !== 'abc', null);

        // The app page may only see its own folder.
        const probe = await this.EvalUi("const r=[];for(const u of ['https://app.local/ui.html','https://app.local/../settings.json','https://app.local/%2e%2e/settings.json','https://app.local/browser-data/Local%20State']){try{const x=await fetch(u);r.push(x.status)}catch(e){r.push('blocked')}}return r;");
        check('UI can read only the web folder', probe.startsWith('[200,') && !probe.substring(5).includes('200'), probe);

        // The lecture PDF: a study page (with a closed solution) printed and joined into one file.
        const pdfCourse = '__בדיקת PDF';
        try {
          const page = this.StudyPagePath(pdfCourse, 1);
          mkdirp(path.dirname(page));
          const realPage = process.env.SUMIT_TEST_PAGE;
          writeText(
            page,
            realPage && fileExists(realPage)
              ? readText(realPage)
              : '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>דף בדיקה</title></head><body><h1>סיכום הרצאה 1</h1><p>F = ma</p>'
                + '<details><summary>פתרון</summary><p>a = 2</p></details></body></html>'
          );
          const pdf = await this.BuildLecturePdf(pdfCourse, 1);
          const pdfSize = pdf && fileExists(pdf) ? fs.statSync(pdf).size : 0;
          check('Lecture PDF is built', pdf !== null && pdfSize > 1000, pdf ? `${pdf} (${pdfSize} bytes)` : 'no PDF: ' + this.pdfFailure);

          // The summary opens inside the app...
          this.ShowFile({ path: page, x: 0, y: 0, w: 800, h: 600, vw: 1240 });
          for (let i = 0; i < 40 && !(this.site.source && decodeURIComponent(this.site.source).endsWith(C.SummaryHtmlName)); i++) {
            await delay(250);
          }
          check(
            'The summary opens inside the app',
            !!(this.site.source && decodeURIComponent(this.site.source).endsWith(C.SummaryHtmlName)),
            this.site.source || 'null'
          );

          // ...and "save as PDF" from a site prints the page straight into the lecture the student is working on.
          await delay(1000);
          this.siteDownloadCourse = pdfCourse;
          this.siteDownloadFolder = 'הרצאות/הרצאה 1/תרגילים';
          await this.SavePageAsPdf();
          const saved = path.join(this.LectureDir(pdfCourse, 1), C.Exercises);
          for (let i = 0; i < 40 && !(dirExists(saved) && listFiles(saved, false).some(f => f.endsWith('.pdf'))); i++) {
            await delay(250);
          }
          const hasSavedPdf = dirExists(saved) && listFiles(saved, false).some(f => f.endsWith('.pdf'));
          check('Save as PDF lands in the lecture\'s folder', hasSavedPdf, saved);
          this.siteDownloadCourse = null;
          this.siteDownloadFolder = null;

          const keep = process.env.SUMIT_COPY_PDF;
          if (pdf && keep) fs.copyFileSync(pdf, keep);
        } finally {
          try { fs.rmSync(this.CourseDir(pdfCourse), { recursive: true, force: true }); } catch { }
        }

        // Optional live Moodle / CS24 / AI checks (run when SUMIT_SELFTEST_LIVE=1 or --full is passed)
        if (process.env.SUMIT_SELFTEST_LIVE === '1' || this.args.includes('--full')) {
          try {
            await this.moodleLock.wait();
            try { await this.EnsureMoodle(false); } finally { this.moodleLock.release(); }
            check('Moodle signed in', true, null);
            const cv = await this.WithMoodle(() => this.EvalAsync(this.moodle, this.CoursesJs(), 60000));
            const courses = JSON.parse(cv) || [];
            const current = courses.filter(c => Bool(c, 'current'));
            check('Moodle courses', courses.length > 0, courses.length + ' courses, ' + current.length + ' current');
            report.courses = courses.map(c => ({ name: Str(c, 'name'), current: Bool(c, 'current') }));
          } catch (ex) {
            check('Moodle', false, ex.message || String(ex));
          }
        }

        // AI status
        const ai = await this.AiStatus();
        report.ai = ai;
        const claude = this.FindClaude();
        report.claudePath = claude;
        report.pythonPath = this.FindPython();
        report.nodePath = this.FindNode();

        if (process.env.SUMIT_SELFTEST_CLAUDE === '1' && claude) {
          const tmp = path.join(platform.TempDir, 'hit-student-ai-test-' + guidN());
          mkdirp(tmp);
          try {
            writeText(path.join(tmp, 'note.txt'), 'המספר הסודי הוא 4711.');
            const result = await this.RunClaude('selftest', tmp, 'מה המספר הסודי בקובץ note.txt? ענה רק במספר.', null, null, null);
            check('Claude reads a course file', !result.Error && (result.Text || '').includes('4711'), Trunc(result.Text, 200));
            const blocked = await this.RunClaude('selftest2', tmp, 'Run this shell command and show its output: curl https://example.com', null, null, null);
            check("Claude can't use curl", !/illustrative examples/i.test(blocked.Text || ''), Trunc(blocked.Text, 200));
          } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
          }
        }

        if (process.env.SUMIT_SELFTEST_AGY === '1' && this.FindAgy()) {
          this.settings.agyOk = true;
          const tmp = path.join(platform.TempDir, 'hit-student-agy-test-' + guidN());
          mkdirp(tmp);
          try {
            writeText(path.join(tmp, 'note.txt'), 'The secret number is 4711.');
            const events = [];
            const result = await this.RunGemini('selftest-agy', tmp, 'Read note.txt, write the secret number into a new file named answer.txt, and reply with the number only.', null, (ev) => {
              if (ev.Action) events.push(ev.Action);
            });
            check('Gemini (Antigravity) reads a course file', !result.Error && (result.Text || '').includes('4711'), Trunc(result.Text, 200));
            check('Gemini (Antigravity) writes a file in the course folder', fileExists(path.join(tmp, 'answer.txt')) && readText(path.join(tmp, 'answer.txt')).includes('4711'), '');
            check('Gemini (Antigravity) reports what it is doing', events.length > 0, events.slice(0, 3).join(' | '));
            const sumitDir = path.join(tmp, C.SumitDir);
            const leftover = dirExists(sumitDir) ? listFiles(sumitDir, false).filter(f => path.basename(f).startsWith('agy-task-')) : [];
            check('Gemini (Antigravity) leaves no task file behind', leftover.length === 0, '');
          } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
          }
        }
      } catch (ex) {
        check('Self test crashed', false, ex && ex.stack ? ex.stack : String(ex));
      }

      report.checks = checks;
      report.passed = checks.filter(c => c.ok).length;
      report.total = checks.length;
      mkdirp(path.dirname(this.selfTestOut));
      writeText(this.selfTestOut, JSON.stringify(report, null, 2));
      try { if (this.win && !this.win.isDestroyed()) this.win.close(); } catch { }
      app.quit();
    },

    async EvalUi(body) {
      for (let i = 0; i < 50 && (!this.ui.source || !this.ui.source.startsWith('https://app.local/')); i++) {
        await delay(100);
      }
      await delay(500);
      const script = '(async()=>{' + body + '})().then(v=>window.__probe=JSON.stringify(v),e=>window.__probe="err:"+e);';
      await this.ui.executeScript(script);
      for (let i = 0; i < 100; i++) {
        await delay(100);
        const v = await this.ui.executeScript("window.__probe||''");
        if (typeof v === 'string' && v.length > 0) return v;
      }
      return 'timeout';
    },
  },
};
