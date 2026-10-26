'use strict';
// Port of src/SummaryShare.cs: export interactive summaries and referenced local assets as shareable ZIP files.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { dialog } = require('electron');
const { Str, IsInside, SafeName, fileExists, guidN } = require('../util');
const platform = require('../platform');

const ShareExtensions = new Set([
  '.html', '.htm', '.pdf', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

const ShareReferences = /(?<attr>\b(?:src|href|poster)\s*=\s*["'])(?<ref>[^"']+)(?<end>["'])|(?<attr>url\(\s*["']?)(?<ref>[^\s)"']+)(?<end>["']?\s*\))/gi;

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function shareText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm' || ext === '.css';
}

function shareReferencePath(source, reference, root) {
  const value = decodeHtmlEntities(reference).trim();
  if (!value || value.startsWith('#')) return null;
  let targetUrl;
  try {
    const base = new URL('file://' + path.resolve(source));
    targetUrl = new URL(value, base);
  } catch { return null; }
  if (targetUrl.protocol !== 'file:') return null;
  const targetPath = path.resolve(decodeURIComponent(targetUrl.pathname));
  if (!IsInside(targetPath, root)) {
    throw new Error('קישור מקומי מחוץ לקורס אינו ניתן לשיתוף: ' + path.basename(targetPath));
  }
  if (!ShareExtensions.has(path.extname(targetPath).toLowerCase())) {
    throw new Error('סוג קובץ מקושר אינו נתמך לשיתוף: ' + path.basename(targetPath));
  }
  let current = targetPath;
  while (IsInside(current, root)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error('לא ניתן לארוז קישור לתיקייה או לקובץ אחר: ' + path.basename(current));
      }
    } catch (e) {
      if (e.message && e.message.includes('לא ניתן לארוז')) throw e;
    }
    if (path.resolve(current) === path.resolve(root)) break;
    current = path.dirname(current);
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error('קובץ מקושר חסר. יש לשחזר אותו לפני השיתוף: ' + path.basename(targetPath));
  }
  return targetPath;
}

function buildSummaryShare(root, page, pdf, output) {
  const fullRoot = path.resolve(root);
  const fullPage = path.resolve(page);
  shareReferencePath(fullPage, fullPage, fullRoot);
  const pageExt = path.extname(fullPage).toLowerCase();
  if (pageExt !== '.html' && pageExt !== '.pdf') {
    throw new Error('בחר סיכום HTML או PDF לשיתוף');
  }

  const files = new Set();
  const queue = [fullPage];
  if (pdf && pdf.trim().length > 0) {
    const fullPdf = path.resolve(pdf);
    queue.push(shareReferencePath(fullPage, fullPdf, fullRoot));
  }

  let totalBytes = 0;
  while (queue.length > 0) {
    const src = queue.shift();
    if (files.has(src)) continue;
    files.add(src);
    totalBytes += fs.statSync(src).size;
    if (files.size > 3000 || totalBytes > 300 * 1024 * 1024) {
      throw new Error('חבילת השיתוף גדולה מדי (עד 300 מגה־בייט)');
    }
    if (shareText(src)) {
      const content = fs.readFileSync(src, 'utf8');
      let m;
      ShareReferences.lastIndex = 0;
      while ((m = ShareReferences.exec(content)) !== null) {
        const ref = m.groups ? m.groups.ref : null;
        if (ref) {
          const linked = shareReferencePath(src, ref, fullRoot);
          if (linked && !files.has(linked)) queue.push(linked);
        }
      }
    }
  }

  // Build the zip file using python3's zipfile module
  const manifest = [];
  const relativeFn = (p) => p.substring(fullRoot.length + 1).replace(/\\/g, '/');
  for (const f of files) {
    manifest.push({
      src: f,
      dest: 'files/' + relativeFn(f),
      isText: shareText(f),
    });
  }

  const pyScript = `
import sys, json, zipfile, os, html

root, page_path, out_zip, manifest_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
manifest = json.loads(manifest_json)

def relative_fn(p):
    return p[len(root)+1:].replace('\\\\', '/')

with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in manifest:
        src = item['src']
        dest = item['dest']
        if item['isText']:
            with open(src, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            z.writestr(dest, content.encode('utf-8'))
        else:
            z.write(src, dest)

    rel_page = relative_fn(page_path)
    escaped_target = "files/" + "/".join([x for x in rel_page.split('/')])
    html_target = html.escape(escaped_target)
    entry_html = f"<!doctype html><html lang=he dir=rtl><meta charset=utf-8><title>פתיחת הסיכום</title><meta http-equiv=refresh content=\\"0;url={html_target}\\"><a href=\\"{html_target}\\">פתח את הסיכום</a></html>"
    z.writestr("פתח את הסיכום.html", entry_html.encode('utf-8'))

    instructions = "אפשר לשלוח את קובץ ה-ZIP ב-WhatsApp כמסמך, או לשמור בתיקיית OneDrive משותפת ולשלוח קישור.\\r\\nיש לחלץ את כל קובץ ה-ZIP, ואז לפתוח את 'פתח את הסיכום.html' בדפדפן. אין להזיז את הקבצים בנפרד.\\r\\nהחבילה כוללת את הסיכום, קובצי העיצוב והנוסחאות והקבצים המקומיים המקושרים אליו. קישורים לאתרים חיצוניים דורשים אינטרנט.\\r\\n"
    z.writestr("הוראות.txt", instructions.encode('utf-8'))
`;

  const py = platform.PythonExe || 'python3';
  const res = spawnSync(py, ['-c', pyScript, fullRoot, fullPage, output, JSON.stringify(manifest)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error('שגיאה באריזת קובץ ה-ZIP: ' + (res.stderr || res.stdout || 'unknown'));
  }
}

module.exports = {
  buildSummaryShare,
  methods: {
    async ShareSummary(message) {
      const requestId = Str(message, 'requestId');
      if (this.summaryShareBusy) {
        this.Send({ type: 'summaryShareResult', requestId, status: 'error', text: 'כבר מתבצעת הכנת קובץ לשיתוף' });
        return;
      }
      this.summaryShareBusy = true;
      let temp = null, status = 'cancelled', result = 'השמירה בוטלה. אפשר ללחוץ שוב על שיתוף.';
      try {
        const course = Str(message, 'course');
        const page = Str(message, 'path');
        const pdf = Str(message, 'pdf');
        const root = this.CourseDir(course);
        if (!course || !IsInside(root, this.StudyRoot) || !IsInside(page, root) || !fileExists(page)) {
          throw new Error('הסיכום אינו זמין לשיתוף');
        }

        const defaultFileName = SafeName(course + ' - ' + Str(message, 'title')) + '.zip';
        const saveDialog = await dialog.showSaveDialog(this.win, {
          title: 'שמירת הסיכום לשיתוף',
          defaultPath: path.join(platform.UserHome, 'Downloads', defaultFileName),
          filters: [{ name: 'קובץ ZIP לשיתוף', extensions: ['zip'] }],
        });

        if (saveDialog.canceled || !saveDialog.filePath) return;
        const destination = saveDialog.filePath;

        this.Send({ type: 'summaryShareProgress', requestId, text: 'מכין קובץ ZIP עם הסיכום והקבצים הנדרשים…' });
        temp = path.join(path.dirname(destination), '.sumit-share-' + guidN() + '.tmp');

        await new Promise((resolve, reject) => {
          try {
            buildSummaryShare(root, page, pdf, temp);
            resolve();
          } catch (err) { reject(err); }
        });

        if (fileExists(destination)) fs.unlinkSync(destination);
        fs.renameSync(temp, destination);
        status = 'saved';
        result = 'קובץ ה-ZIP נשמר בהצלחה ומוכן לשליחה.';
      } catch (ex) {
        status = 'error';
        result = 'לא הצלחתי לשמור את ה-ZIP: ' + (ex.message || String(ex));
      } finally {
        if (temp && fileExists(temp)) { try { fs.unlinkSync(temp); } catch { } }
        this.summaryShareBusy = false;
        this.Send({ type: 'summaryShareResult', requestId, status, text: result });
      }
    },
  },
};
