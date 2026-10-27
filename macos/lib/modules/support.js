'use strict';
// Port of Support.cs and SummaryFormat.cs (v1.0.15 and v1.0.16)
// Provides diagnostics logging, ZIP diagnostics export, shared summary import/unpacking,
// and outdated summary detection/refreshing.

const fs = require('fs');
const path = require('path');
const { app, dialog, clipboard } = require('electron');
const util = require('../util');
const { Str, Bool, Int, Dict, Arr, Trunc, IsInside, SafeName, mkdirp, fileExists, dirExists, readText, writeText } = util;
const platform = require('../platform');
const C = require('../constants');
const { spawnSync } = require('child_process');

const SummaryFormatVersion = 2;

function FailureKind(error) {
  const err = error || '';
  if (/usage limit|session limit|rate.?limit|limit reached|hit your limit|quota[ _-]*(exceeded|exhausted)|RESOURCE_EXHAUSTED|\b429\b|5-hour limit|weekly limit/i.test(err)) return 'rate-or-quota';
  if (/unauthenticated|authentication|not logged|\b401\b|\b403\b/i.test(err)) return 'authentication';
  if (/unknown option|unrecognized|invalid argument/i.test(err)) return 'cli-arguments';
  if (/model.*(not found|not supported)|\b404\b/i.test(err)) return 'model-unavailable';
  if (/timeout|timed out|הזמן הקצוב/i.test(err)) return 'timeout';
  if (/network|connection|fetch failed|ENOTFOUND/i.test(err)) return 'network';
  return 'unknown';
}

module.exports = {
  init(host) {
    host.cloudImportCourse = null;
    host.cloudImportLecture = 0;
  },

  methods: {
    FailureKind,
    DiagnosticDir() {
      return path.join(platform.DataRoot, 'diagnostics');
    },

    Diagnostic(operation, provider, kind, code = 0) {
      try {
        const dir = this.DiagnosticDir();
        mkdirp(dir);
        const file = path.join(dir, 'events.log');
        if (fileExists(file)) {
          const stat = fs.statSync(file);
          if (stat.size > 1024 * 1024) {
            fs.copyFileSync(file, file + '.previous');
            writeText(file, '');
          }
        }
        const safe = (s) => (s || '').replace(/[^A-Za-z0-9_.-]/g, '');
        const line = new Date().toISOString() + ' version=' + C.Version + ' operation=' + safe(operation) + ' provider=' + safe(provider) + ' kind=' + safe(kind) + ' code=' + code + '\n';
        fs.appendFileSync(file, line, 'utf8');
      } catch { }
    },

    RecordUiFailure(message) {
      try {
        if (!message || typeof message !== 'object') return;
        if (message.error || message.status === 'error' || message.state === 'failed') {
          this.Diagnostic(Str(message, 'type'), '', FailureKind(Str(message, 'text')));
        }
      } catch { }
    },

    async ExportDiagnostics() {
      try {
        const dateStr = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
        const res = await dialog.showSaveDialog(this.win, {
          title: 'שמור דוח אבחון לשליחה לתמיכה',
          defaultPath: 'SumIT-diagnostics-' + dateStr + '.zip',
          filters: [{ name: 'דוח אבחון ZIP', extensions: ['zip'] }],
        });
        if (res.canceled || !res.filePath) return;

        const outZip = res.filePath;
        const workDir = path.join(platform.TempDir, 'sumit-diag-' + Date.now());
        mkdirp(workDir);

        const sysInfo = {
          version: C.Version,
          os: process.platform + ' ' + process.arch,
          runtime: process.version,
          geminiMode: this.HelperMode ? this.HelperMode('gemini') : '',
          openaiMode: this.HelperMode ? this.HelperMode('openai') : '',
          claudeConnected: !!this.claudeLoggedIn,
          note: 'Technical event identifiers only. No settings files, credentials, prompts, course content or browser data.',
        };
        writeText(path.join(workDir, 'system.json'), JSON.stringify(sysInfo, null, 2));

        const diagDir = this.DiagnosticDir();
        for (const f of ['events.log', 'events.log.previous']) {
          const src = path.join(diagDir, f);
          if (fileExists(src)) fs.copyFileSync(src, path.join(workDir, f));
        }

        // Pack workDir into outZip using python3
        const script = `
import sys, os, zipfile
work_dir = sys.argv[1]
out_zip = sys.argv[2]
with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in os.listdir(work_dir):
        p = os.path.join(work_dir, name)
        if os.path.isfile(p):
            z.write(p, name)
`;
        const pyRes = spawnSync('python3', ['-c', script, workDir, outZip], { encoding: 'utf8' });
        if (pyRes.status !== 0) throw new Error(pyRes.stderr || 'ZIP packaging failed');

        this.Toast('דוח האבחון נשמר. אפשר לשלוח אותו לתמיכה; הוא לא נשלח אוטומטית.', false);
      } catch (ex) {
        this.Toast('שמירת דוח האבחון נכשלה: ' + (ex.message || String(ex)), true);
      }
    },

    // ---------- Summary Format (SummaryFormat.cs) ----------
    FormatFile(course, num) {
      return path.join(this.CourseDir(course), C.SumitDir, 'format', num + '.txt');
    },

    MarkSummaryFormat(course, num) {
      try {
        const f = this.FormatFile(course, num);
        mkdirp(path.dirname(f));
        writeText(f, String(SummaryFormatVersion));
      } catch { }
    },

    OutdatedSummaries() {
      const list = [];
      try {
        if (!this.StudyRoot || !dirExists(this.StudyRoot)) return list;
        for (const cd of fs.readdirSync(this.StudyRoot)) {
          const courseDir = path.join(this.StudyRoot, cd);
          if (!fs.statSync(courseDir).isDirectory()) continue;
          const meta = this.LoadMeta(cd);
          const rows = Array.isArray(meta.lectures) ? meta.lectures : [];
          for (const r of rows) {
            const n = Int(r, 'num');
            if (n < 1 || !fileExists(this.StudyPagePath(cd, n))) continue;
            const f = this.FormatFile(cd, n);
            const val = fileExists(f) ? readText(f).trim() : '';
            if (val !== String(SummaryFormatVersion)) {
              list.push({ course: cd, num: n, title: Str(r, 'title') });
            }
          }
        }
      } catch { }
      return list;
    },

    RefreshOutdatedSummaries() {
      const list = this.OutdatedSummaries();
      if (list.length === 0) {
        this.Toast('כל הסיכומים כבר בפורמט החדש', false);
        this.SendSettings();
        return;
      }
      for (const s of list) {
        this.LecturePdfAsync(s.course, s.num, s.title, false, true);
      }
      this.Toast(list.length === 1 ? 'סיכום אחד נכנס לתור' : list.length + ' סיכומים נכנסו לתור, ייבנו אחד אחרי השני', false);
    },

    // ---------- Shared Summaries Import (Support.cs) ----------
    SharedSummaries(course, num) {
      const meta = this.LoadMeta(course);
      const map = Dict(meta, 'sharedSummaries');
      return (map && Array.isArray(map[String(num)])) ? map[String(num)] : [];
    },

    async ImportSharedSummary(course, num, archive) {
      if (!course || num < 1 || num > 200 || !archive || !fileExists(archive)) return;
      const guid = util.guidN ? util.guidN() : Math.random().toString(36).substring(2) + Date.now().toString(36);
      const dest = path.join(this.CourseDir(course), C.SumitDir, 'shared', guid);
      try {
        const pyScript = path.join(__dirname, '..', '..', '..', 'engine', 'scripts', 'import_shared.py');
        const res = spawnSync('python3', [pyScript, archive, dest], { encoding: 'utf8' });
        if (res.status !== 0) throw new Error((res.stderr || res.stdout || 'Import script failed').trim());
        const page = (res.stdout || '').trim();
        if (!page || !fileExists(page)) throw new Error('Unpacked page not found');

        const meta = this.LoadMeta(course);
        const map = Dict(meta, 'sharedSummaries') || {};
        const list = Array.isArray(map[String(num)]) ? map[String(num)] : [];
        const title = path.basename(archive, path.extname(archive));
        list.push({ title, path: page });
        map[String(num)] = list;
        meta.sharedSummaries = map;
        this.SaveMeta(course, meta);
        this.SendSectionLocal(course, num);
        this.Toast('סיכום החבר נוסף להרצאה ' + num + '. הסיכום הקיים נשמר.', false);
        this.Diagnostic('summary-import', '', 'success');
      } catch (ex) {
        this.Diagnostic('summary-import', '', ex.name || 'Error');
        this.Toast('ייבוא הסיכום נכשל: ' + (ex.message || String(ex)), true);
      }
    },

    async PickSharedSummary(m) {
      let file = null;
      if (Bool(m, 'clipboard')) {
        // Check clipboard for path
        const text = clipboard.readText().trim();
        if (text.endsWith('.zip') && fileExists(text)) file = text;
      }
      if (!file) {
        const hitOd = this.HitOneDrive ? this.HitOneDrive() : '';
        const res = await dialog.showOpenDialog(this.win, {
          title: 'בחר ZIP של סיכום חבר',
          defaultPath: Bool(m, 'onedrive') && hitOd ? hitOd : undefined,
          filters: [{ name: 'סיכום ZIP', extensions: ['zip'] }],
          properties: ['openFile'],
        });
        if (res.canceled || !res.filePaths || res.filePaths.length === 0) return;
        file = res.filePaths[0];
      }
      this.ImportSharedSummary(Str(m, 'course'), Int(m, 'num'), file);
    },

    IsOneDrivePage(value) {
      try {
        const u = new URL(value);
        return u.host.toLowerCase() === 'onedrive.live.com' || u.host.toLowerCase().endsWith('.sharepoint.com');
      } catch { return false; }
    },
  },
};
