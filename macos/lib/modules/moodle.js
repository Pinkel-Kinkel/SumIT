'use strict';
// Port of src/Moodle.cs

const fs = require('fs');
const path = require('path');
const { Str, Bool, Int, SafeName, Trunc, Mutex, deferred, delay, fileExists, dirExists, listFiles, listDirs, mkdirp, readText, writeText } = require('../util');
const C = require('../constants');

const ExerciseName = /(תרגיל|תרגול|פתרון|פתרונות|שיעורי בית|מטלה|ש"ב|targ|tirgul|solut|homework|\bhw|exercise|assignment|\bsol)/i;
const ExamName = /(מבחן|מבחנ|בחינ|מועד [אבג]|שנים קודמות|\bexam|midterm|\bfinal)/i;
const SyllabusName = /(סילבוס|סילב|syllabus|syllabi|סילאבוס|course outline|course description|תוכנית הקורס|תכנית הקורס|מידע על הקורס|דרישות הקורס|מבנה הציון)/i;

const CoursesJs = `
const call = async (classification) => {
  const r = await fetch('/lib/ajax/service.php?sesskey=' + M.cfg.sesskey + '&info=core_course_get_enrolled_courses_by_timeline_classification', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify([{index: 0, methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
      args: {offset: 0, limit: 0, classification, sort: 'fullname'}}])});
  const j = await r.json();
  if (j[0].error) throw new Error(j[0].exception && j[0].exception.message || 'Moodle error');
  return j[0].data.courses;
};
const now = await call('inprogress');
const all = await call('all');
const ids = new Set(now.map(c => c.id));
return all.filter(c => !c.hidden).map(c => ({id: c.id, name: c.fullname, short: c.shortname, category: c.coursecategory || '',
  current: ids.has(c.id), progress: c.hasprogress ? c.progress : null, url: c.viewurl}));`;

const HomeJs = `
const ajax = async (methodname, args) => {
  const r = await fetch('/lib/ajax/service.php?sesskey=' + M.cfg.sesskey + '&info=' + methodname, {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify([{index: 0, methodname, args}])});
  const j = await r.json(); if (j[0].error) throw new Error(j[0].exception && j[0].exception.message || 'Moodle error'); return j[0].data;
};
const now = Math.floor(Date.now() / 1000);
let events = [];
try {
  const d = await ajax('core_calendar_get_action_events_by_timesort', {timesortfrom: now - 3 * 86400, timesortto: now + 45 * 86400, limitnum: 50, limittononsuspendedevents: true});
  events = (d.events || []).map(e => ({id: e.id, name: e.activityname || e.name, title: e.name, course: e.course ? e.course.fullname : '', courseId: e.course ? e.course.id : 0,
    when: e.timesort, url: e.url || (e.action && e.action.url) || '', mod: e.modulename || '', overdue: !!e.overdue, action: e.action ? e.action.name : ''}));
} catch (e) {}
let name = '';
try {
  const doc = new DOMParser().parseFromString(await (await fetch('/user/profile.php')).text(), 'text/html');
  const h = doc.querySelector('.page-header-headings h1, .page-context-header h2, h1');
  name = h ? h.textContent.trim() : '';
} catch (e) {}
return {events, name};`;

const LecturerJs = `
const lecturers = [], assistants = [];
const nameOf = (a) => { const c = a.cloneNode(true); c.querySelectorAll('.userinitials, .userpicture, img, .sr-only, .visually-hidden').forEach(x => x.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); };
try {
  const doc = new DOMParser().parseFromString(await (await fetch('/user/index.php?id=' + COURSE_ID + '&perpage=5000')).text(), 'text/html');
  doc.querySelectorAll('table tbody tr').forEach(tr => {
    const a = tr.querySelector('a[href*="/user/view.php"]');
    if (!a) return;
    const name = nameOf(a);
    const roles = [...tr.querySelectorAll('td')].map(td => td.textContent).join(' ');
    if (!name) return;
    if (/מרצה|editing ?teacher|\\bteacher\\b|מורה/i.test(roles) && !/סטודנט|student/i.test(roles)) lecturers.push(name);
    else if (/מתרגל|assistant|non-editing/i.test(roles)) assistants.push(name);
  });
} catch (e) {}
if (!lecturers.length) {
  try {
    const doc = new DOMParser().parseFromString(await (await fetch('/course/info.php?id=' + COURSE_ID)).text(), 'text/html');
    doc.querySelectorAll('.teachers a, .course-contacts a, ul.teachers li a').forEach(a => lecturers.push(nameOf(a)));
  } catch (e) {}
}
return [...new Set(lecturers)].slice(0, 3);`;

const SectionsJs = `
const base = location.origin;
const abs = (h) => { try { return new URL(h, base).href; } catch (e) { return null; } };
const clean = (el) => {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.accesshide, .sr-only, .visually-hidden, button, .icons-collapse-expand, [data-toggle="collapse"], [data-bs-toggle="collapse"]').forEach(x => x.remove());
  return c.textContent.replace(/תצוגה מצומצמת|תצוגה מורחבת|Collapse|Expand/g, '').replace(/\\s+/g, ' ').trim();
};
const load = async (url) => new DOMParser().parseFromString(await (await fetch(url, {credentials: 'include'})).text(), 'text/html');
const readItems = (root) => {
  const items = [], seen = new Set();
  root.querySelectorAll('li.activity').forEach(a => {
    const link = a.querySelector('a.aalink, .activityname a, a[href*="/mod/"]');
    const mod = ((a.className.match(/modtype_(\\w+)/) || [])[1]) || '';
    const name = clean(a.querySelector('.instancename, .activityname')) || clean(link);
    const url = link ? abs(link.getAttribute('href')) : null;
    const dates = clean(a.querySelector('[data-region="activity-dates"], .activity-dates'));
    if (mod === 'label') {
      a.querySelectorAll('a[href]').forEach(x => {
        const h = abs(x.getAttribute('href'));
        if (!h || seen.has(h)) return;
        if (/zoom\\.us\\/rec/i.test(h)) { seen.add(h); items.push({mod: 'zoom', name: clean(x) || 'Zoom', url: h}); }
        else if (/pluginfile\\.php/i.test(h)) { seen.add(h); items.push({mod: 'file', name: clean(x) || decodeURIComponent(h.split('/').pop().split('?')[0]), url: h}); }
      });
      return;
    }
    if (url && !seen.has(url)) { seen.add(url); items.push({mod, name, url, dates}); }
  });
  root.querySelectorAll('.summary a[href], .summarytext a[href], [data-for="sectioninfo"] a[href]').forEach(x => {
    const h = abs(x.getAttribute('href'));
    if (!h || seen.has(h)) return;
    if (/zoom\\.us\\/rec/i.test(h)) { seen.add(h); items.push({mod: 'zoom', name: clean(x) || 'Zoom', url: h}); }
    else if (/pluginfile\\.php/i.test(h)) { seen.add(h); items.push({mod: 'file', name: clean(x) || decodeURIComponent(h.split('/').pop().split('?')[0]), url: h}); }
  });
  return items;
};
const doc = await load('/course/view.php?id=' + COURSE_ID);
let nodes = [...doc.querySelectorAll('li.section, li[data-for="section"]')];
nodes = nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
const out = [];
for (let i = 0; i < nodes.length; i++) {
  const s = nodes[i];
  const numAttr = s.getAttribute('data-number') ?? s.getAttribute('data-sectionnum') ?? (s.id || '').replace('section-', '');
  const num = /^\\d+$/.test(numAttr) ? parseInt(numAttr) : i;
  const title = clean(s.querySelector('.sectionname, [data-for="section_title"], h3')) || ('יחידה ' + num);
  const summary = clean(s.querySelector('.summary, .summarytext, [data-for="sectioninfo"]')).slice(0, 400);
  let items = readItems(s);
  if (!items.length) {
    const more = s.querySelector('a[href*="section.php"], a[href*="&section="]');
    if (more) { try { items = readItems(await load(abs(more.getAttribute('href')))); } catch (e) {} }
  }
  out.push({num, title, summary, items});
}
return out;`;

function Ajax(method, argsJson) {
  return "const r=await fetch('/lib/ajax/service.php?sesskey='+M.cfg.sesskey+'&info=" + method + "',{method:'POST',headers:{'Content-Type':'application/json'},"
    + "body:JSON.stringify([{index:0,methodname:'" + method + "',args:" + argsJson + "}])});const j=await r.json();"
    + "if(j[0].error) throw new Error((j[0].exception&&j[0].exception.message)||'Moodle error');return j[0].data;";
}

function LectureFolderName(num) {
  return num === 0 ? C.General : path.join('הרצאות', 'הרצאה ' + num);
}

function IsSummaryFile(p) {
  return path.basename(p).startsWith('.') || p.includes(path.sep + C.SummaryName + path.sep);
}

function CountFiles(dir) {
  return dirExists(dir) ? listFiles(dir, true).filter(f => !path.basename(f).startsWith('.')).length : 0;
}

function IsExercise(name) { return ExerciseName.test(name || ''); }

function LectureSubdir(lectureDir, kind, fileName) {
  if (kind === 'homework' || (!kind && IsExercise(fileName)) || (kind === 'slides' && IsExercise(fileName))) {
    return path.join(lectureDir, C.Exercises);
  }
  if (kind === 'notes') return path.join(lectureDir, C.Notebook);
  return path.join(lectureDir, C.LecturerNotes);
}

function IsMoodleUrl(url) {
  try {
    const u = new URL(url || '');
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 'md.hit.ac.il';
  } catch { return false; }
}

function IsZoomUrl(url) {
  try {
    const u = new URL(url || '');
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'zoom.us' || host.endsWith('.zoom.us')) && u.pathname.toLowerCase().startsWith('/rec/');
  } catch { return false; }
}

function parseContentDispositionFilename(cd) {
  if (!cd) return null;
  const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i.exec(cd);
  if (star && star[1]) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain && plain[1] ? plain[1].trim() : null;
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = {
  init(host) {
    host.moodleLock = new Mutex();
    host.moodleCancelled = false;
    host.busySections = new Set();
    host.syncingCourses = new Set();
    host.lastCourses = null;
  },
  methods: {
    ExerciseNameRe() { return ExerciseName; },
    ExamNameRe() { return ExamName; },
    SyllabusNameRe() { return SyllabusName; },
    SectionsJs() { return SectionsJs; },
    CoursesJs() { return CoursesJs; },
    HomeJs() { return HomeJs; },
    LecturerJs() { return LecturerJs; },
    LectureFolderName,
    IsSummaryFile,
    CountFiles,
    IsExercise,
    LectureSubdir,
    IsMoodleUrl,
    IsZoomUrl,

    EvalAsync(view, body, timeoutMs = 30000) {
      return view.evalAsync(body, timeoutMs);
    },

    SendMoodle(state, message) {
      this.Send({ type: 'moodle', state, message });
    },

    async ConnectMoodle() {
      try {
        await this.moodleLock.wait();
        try { await this.EnsureMoodle(true); }
        finally { this.moodleLock.release(); }
        this.LoadHome();
      } catch (ex) {
        this.bringToFront('ui');
        this.SendMoodle('error', ex.message || String(ex));
      }
    },

    async EnsureMoodle(interactive) {
      if (await this.MoodleReady()) return;
      this.SendMoodle('connecting', '');
      this.moodleCancelled = false;
      this.moodle.navigate(C.MoodleBase + '/my/');
      const started = Date.now();
      let shown = false;
      while (true) {
        await delay(500);
        if (this.moodleCancelled) {
          this.moodleCancelled = false;
          this.SendMoodle('login', '');
          throw new Error('ההתחברות ל-Moodle בוטלה');
        }
        if (await this.MoodleReady()) break;
        const elapsedSec = (Date.now() - started) / 1000;
        if (elapsedSec > 4 && !shown) {
          if (!interactive) {
            this.SendMoodle('login', '');
            throw new Error('צריך להתחבר ל-Moodle');
          }
          shown = true;
          this.bringToFront('moodle');
          this.SendMoodle('login', '');
        }
        if (elapsedSec > 600) throw new Error('פג הזמן להתחברות');
      }
      this.bringToFront('ui');
      this.SendMoodle('ready', '');
    },

    async MoodleReady() {
      const src = this.moodle.source || '';
      if (!src.toLowerCase().startsWith(C.MoodleBase.toLowerCase()) || src.toLowerCase().includes('/login/')) return false;
      try {
        const v = await this.EvalAsync(
          this.moodle,
          'return (typeof M!=="undefined"&&M.cfg&&M.cfg.sesskey&&document.body&&!document.body.classList.contains("notloggedin")&&!document.querySelector(\'a[href*="/login/index.php"].btn, .usermenu .login\'))?M.cfg.sesskey:"";',
          4000
        );
        const key = JSON.parse(v);
        return typeof key === 'string' && key.length > 0;
      } catch { return false; }
    },

    async MoodleHeartbeat() {
      if (!await this.moodleLock.wait(true)) return 'ready';
      try {
        if (await this.MoodleReady()) {
          try {
            await this.EvalAsync(this.moodle, Ajax('core_session_touch', '{}'), 15000);
            return 'ready';
          } catch { }
        }
        try { await this.EnsureMoodle(false); return 'ready'; }
        catch { return 'login'; }
      } finally {
        this.moodleLock.release();
      }
    },

    async WithMoodle(work) {
      await this.moodleLock.wait();
      try {
        await this.EnsureMoodle(true);
        return await work();
      } finally {
        this.moodleLock.release();
      }
    },

    async LoadCourses() {
      try {
        const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, CoursesJs, 60000));
        this.lastCourses = JSON.parse(v) || [];
        for (const c of this.lastCourses) c.local = this.CourseLocal(Str(c, 'name'));
        this.Send({ type: 'courses', data: this.lastCourses });
      } catch (ex) {
        this.bringToFront('ui');
        this.SendMoodle('error', ex.message || String(ex));
      }
    },

    async LoadHome() {
      try {
        const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, HomeJs, 60000));
        const home = JSON.parse(v) || {};
        const name = Str(home, 'name');
        if (name.length > 0 && name !== Str(this.settings, 'userName')) {
          this.settings.userName = name;
          this.SaveSettings();
        }
        this.Send({ type: 'home', events: home.events || [], name });
        if (!this.lastCourses) this.LoadCourses();
      } catch (ex) {
        this.bringToFront('ui');
        this.SendMoodle('error', ex.message || String(ex));
      }
    },

    async OpenCourse(id, name) {
      try {
        const cachedMeta = this.LoadMeta(name);
        const cached = Array.isArray(cachedMeta.sectionsCache) ? cachedMeta.sectionsCache : [];
        for (const s of cached) if (s && typeof s === 'object') s.local = this.LocalInfo(name, Int(s, 'num'));
        this.Send({
          type: 'course', id, name, folder: this.CourseDir(name), sections: cached, cached: true,
          lecturer: Str(cachedMeta, 'lecturer'), lecturerGuess: Array.isArray(cachedMeta.lecturerGuess) ? cachedMeta.lecturerGuess : [],
          local: this.CourseLocal(name), notability: this.NotabilityInfo(name),
        });

        const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, SectionsJs.replace(/COURSE_ID/g, String(id)), 120000));
        const sections = JSON.parse(v) || [];
        const meta = this.LoadMeta(name);
        meta.courseId = id;
        meta.sectionsCache = JSON.parse(v);
        if (Str(meta, 'lecturer').length === 0 && !('lecturerGuess' in meta)) {
          try {
            const lv = await this.WithMoodle(() => this.EvalAsync(this.moodle, LecturerJs.replace(/COURSE_ID/g, String(id)), 40000));
            meta.lecturerGuess = JSON.parse(lv) || [];
          } catch { meta.lecturerGuess = []; }
        }
        this.SaveMeta(name, meta);
        for (const s of sections) s.local = this.LocalInfo(name, Int(s, 'num'));
        this.CheckNewMaterial(name, sections, false);
        this.Send({
          type: 'course', id, name, folder: this.CourseDir(name), sections,
          lecturer: Str(meta, 'lecturer'), lecturerGuess: meta.lecturerGuess, local: this.CourseLocal(name),
          notability: this.NotabilityInfo(name),
        });
      } catch (ex) {
        this.bringToFront('ui');
        this.Send({ type: 'courseError', id, message: ex.message || String(ex) });
      }
    },

    // ---------- Course folders ----------

    CourseDir(course) { return path.join(this.StudyRoot, SafeName(course)); },
    LectureDir(course, num) { return path.join(this.CourseDir(course), LectureFolderName(num)); },
    StudyPagePath(course, num) { return path.join(this.LectureDir(course, num), C.SummaryName, C.SummaryHtmlName); },

    LocalInfo(course, num) {
      const dir = this.LectureDir(course, num);
      let files = 0, videos = 0, transcripts = 0;
      const recDir = path.join(dir, C.RecordingFolder);
      if (dirExists(dir)) {
        for (const f of listFiles(dir, true)) {
          const ext = path.extname(f).toLowerCase();
          if (ext === '.mp4' && path.dirname(f).toLowerCase() === recDir.toLowerCase()) videos++;
          else if (f.endsWith(C.TranscriptSuffix + '.txt')) transcripts++;
          else if (!IsSummaryFile(f) && !f.includes(path.sep + C.PointersFolder + path.sep)) files++;
        }
      }
      const page = this.StudyPagePath(course, num);
      const exercisesDir = path.join(dir, C.Exercises);
      const pointersDir = path.join(exercisesDir, C.PointersFolder);
      const pointers = dirExists(pointersDir)
        ? listFiles(pointersDir, false).filter(p => p.toLowerCase().endsWith('.pdf'))
          .map(p => ({ name: path.basename(p, path.extname(p)), path: p }))
        : [];
      const exercises = dirExists(exercisesDir) ? listFiles(exercisesDir, false).length : 0;
      const recordingFiles = dirExists(recDir)
        ? listFiles(recDir, false)
          .filter(f => ['.mp4', '.webm', '.mkv', '.m4a'].includes(path.extname(f).toLowerCase()))
          .map(f => {
            const base = path.basename(f, path.extname(f));
            return {
              name: base,
              ext: path.extname(f).toLowerCase(),
              path: f,
              transcript: fileExists(path.join(recDir, base + ' ' + C.TranscriptSuffix + '.txt')),
            };
          })
        : [];
      const recDirPrefix = (recDir + path.sep).toLowerCase();
      const materialFiles = dirExists(dir)
        ? listFiles(dir, true)
          .filter(f => !IsSummaryFile(f) && !f.includes(path.sep + C.PointersFolder + path.sep) && !f.toLowerCase().startsWith(recDirPrefix))
          .sort()
          .map(f => ({ name: f.substring(dir.length + 1), path: f }))
        : [];
      const shared = this.SharedSummaries ? this.SharedSummaries(course, num) : [];
      return {
        dir, exists: dirExists(dir), files, videos: recordingFiles.length, transcripts, recordings: recordingFiles,
        studyPage: fileExists(page) ? page : null, exercises, pointers, materialFiles,
        sharedSummaries: shared,
        lecturePdf: fileExists(this.LecturePdfPath(course, num)) ? this.LecturePdfPath(course, num) : null,
      };
    },

    CourseLocal(course) {
      const dir = this.CourseDir(course);
      const info = path.join(dir, C.CourseJson);
      let courseInfo = null;
      try { if (fileExists(info)) courseInfo = JSON.parse(readText(info)); } catch { }
      const lecturesDir = path.join(dir, 'הרצאות');
      const lectureFolders = dirExists(lecturesDir) ? listDirs(lecturesDir).filter(d => path.basename(d).startsWith('הרצאה ')) : [];
      const pageCount = lectureFolders.filter(d => fileExists(path.join(d, C.SummaryName, C.SummaryHtmlName))).length;
      const pdfCount = lectureFolders.filter(d => fileExists(path.join(d, C.SummaryName, C.SummaryPdfName))).length;
      const prep = path.join(dir, C.Exams, C.ExamPrepPage);
      const profile = path.join(dir, C.LecturerProfile);
      const meta = this.LoadMeta(course);
      const recRoot = path.join(dir, C.LectureRecordings);
      return {
        dir, exists: dirExists(dir),
        exams: CountFiles(path.join(dir, C.Exams)),
        infoFiles: CountFiles(path.join(dir, C.CourseInfoFolder)),
        notes: CountFiles(path.join(dir, C.Notebook)),
        cs24: CountFiles(path.join(dir, C.Cs24Folder)),
        studyPages: pageCount,
        info: courseInfo,
        lecturePdfs: pdfCount,
        examPrep: fileExists(prep) ? prep : null,
        lecturerProfile: fileExists(profile) ? profile : null,
        courseInfoMd: fileExists(path.join(dir, C.CourseInfoFolder + '.md')) ? path.join(dir, C.CourseInfoFolder + '.md') : null,
        examsSkipped: Bool(meta, 'examsSkipped'),
        background: this.BackgroundFor(course),
        setupDone: true,
        lectures: this.ManualLectures(course),
        lectureCalendar: 'lectureCalendar' in meta ? meta.lectureCalendar : null,
        lectureRecordings: dirExists(recRoot)
          ? listFiles(recRoot, false).filter(f => f.toLowerCase().endsWith('.mp4')).sort()
            .map(f => ({ name: path.basename(f, path.extname(f)), path: f }))
          : [],
      };
    },

    SendSectionLocal(course, num) {
      this.Send({ type: 'sectionLocal', course, num, local: this.LocalInfo(course, num) });
    },

    SendCourseLocal(course) {
      this.Send({ type: 'courseLocal', course, local: this.CourseLocal(course), notability: this.NotabilityInfo(course) });
    },

    SectionStatus(course, num, text, busy, error) {
      this.Send({ type: 'sectionStatus', course, num, text, busy: !!busy, error: !!error });
    },

    LoadMeta(course) {
      const file = path.join(this.CourseDir(course), '.hit-student.json');
      try { if (fileExists(file)) return JSON.parse(readText(file)) || {}; } catch { }
      return {};
    },

    SaveMeta(course, meta) {
      const dir = this.CourseDir(course);
      mkdirp(dir);
      const file = path.join(dir, '.hit-student.json');
      try { writeText(file, JSON.stringify(meta)); } catch { }
    },

    async AddFiles(course, folder, kind = '') {
      const files = await this.pickFiles('הוסף קבצים', [], true);
      if (!files || files.length === 0) return;
      const num = /^\d+$/.test(String(folder)) ? parseInt(folder, 10) : NaN;
      const isNum = !isNaN(num);
      const dir = isNum
        ? this.LectureDir(course, num)
        : path.join(this.CourseDir(course), folder === C.CourseInfoFolder ? C.CourseInfoFolder : C.Exams);
      for (const f of files) {
        const name = path.basename(f);
        const target = isNum ? LectureSubdir(dir, kind, name) : dir;
        mkdirp(target);
        let dest = path.join(target, SafeName(name));
        if (path.resolve(f).toLowerCase() === path.resolve(dest).toLowerCase()) continue;
        const ext = path.extname(name);
        const base = SafeName(path.basename(name, ext));
        for (let suffix = 2; fileExists(dest); suffix++) {
          dest = path.join(target, base + ' (' + suffix + ')' + ext);
        }
        fs.copyFileSync(f, dest);
      }
      if (isNum) this.SendSectionLocal(course, num);
      this.SendCourseLocal(course);
      this.Toast(files.length + ' קבצים נוספו', false);
    },

    TargetFor(course, num, mod, name) {
      if (SyllabusName.test(name || '')) return path.join(this.CourseDir(course), C.CourseInfoFolder);
      if (ExamName.test(name || '')) return path.join(this.CourseDir(course), C.Exams);
      const dir = this.LectureDir(course, num);
      return mod === 'assign' ? path.join(dir, C.Exercises) : LectureSubdir(dir, '', name);
    },

    async SyncCourse(course, sections) { await this.SyncCourseAsync(course, sections); },

    async PrepareCourses(courses) {
      if (!Array.isArray(courses)) return;
      const list = courses.filter(c => c && typeof c === 'object');
      for (let i = 0; i < list.length; i++) {
        const name = Str(list[i], 'name');
        const id = Int(list[i], 'id');
        this.Send({ type: 'prepStatus', busy: true, done: i, total: list.length, course: name });
        try {
          const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, SectionsJs.replace(/COURSE_ID/g, String(id)), 120000));
          const meta = this.LoadMeta(name);
          meta.courseId = id;
          this.SaveMeta(name, meta);
          await this.SyncCourseAsync(name, JSON.parse(v));
        } catch (ex) {
          this.Toast(name + ': ' + (ex.message || String(ex)), true);
        }
      }
      this.Send({ type: 'prepStatus', busy: false, done: list.length, total: list.length });
      if (this.lastCourses) {
        for (const c of this.lastCourses) c.local = this.CourseLocal(Str(c, 'name'));
        this.Send({ type: 'courses', data: this.lastCourses });
      }
    },

    async SyncCourseAsync(course, sections) {
      if (!Array.isArray(sections) || this.syncingCourses.has(course)) return;
      this.syncingCourses.add(course);
      try {
        const list = sections.filter(s => s && typeof s === 'object');
        const weight = (s) => 1 + (Array.isArray(s.items) ? s.items.length : 0);
        const total = list.reduce((acc, s) => acc + weight(s), 0) || 1;
        let done = 0;
        for (let i = 0; i < list.length; i++) {
          const before = done;
          await this.SyncSectionAsync(course, list[i], (k, item) => this.Progress(course, 'מוריד מה-Moodle: ' + Trunc(item, 70), (before + 1 + k) / total));
          done += weight(list[i]);
        }
        this.Send({ type: 'courseStatus', course, busy: false, text: '', synced: true });
      } finally {
        this.syncingCourses.delete(course);
      }
    },

    async SyncSection(course, section) { await this.SyncSectionAsync(course, section); },

    async SyncSectionAsync(course, section, onItem = null) {
      if (!section) return;
      const num = Int(section, 'num');
      const key = course + '|' + num;
      if (this.busySections.has(key)) return;
      this.busySections.add(key);

      const items = Array.isArray(section.items) ? section.items.filter(x => x && typeof x === 'object') : [];
      let saved = 0, recordings = 0, failed = 0;
      try {
        this.SectionStatus(course, num, 'מתחבר ל-Moodle...', true, false);
        mkdirp(this.LectureDir(course, num));
        const http = await this.MoodleHttp();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const mod = Str(it, 'mod'), name = Str(it, 'name'), url = Str(it, 'url');
          this.SectionStatus(course, num, 'מוריד ' + (i + 1) + '/' + items.length + ': ' + name, true, false);
          if (onItem) onItem(i, name);
          const target = this.TargetFor(course, num, mod, name);
          const keepImages = mod === 'assign' || IsExercise(name);
          try {
            if (mod === 'zoom') continue;
            if (!IsMoodleUrl(url)) continue;
            if (mod === 'resource') {
              if (await this.DownloadFile(http, url + (url.includes('?') ? '&' : '?') + 'redirect=1', target, keepImages)) saved++;
            } else if (mod === 'file') {
              if (await this.DownloadFile(http, url, target, keepImages)) saved++;
            } else if (mod === 'url') {
              const real = await this.WithMoodle(() => this.ResolveMoodleUrl(url));
              if (IsZoomUrl(real)) { /* manual recordings only */ }
              else if (real && (real.startsWith('https://') || real.startsWith('http://'))) {
                writeText(path.join(this.LectureDir(course, num), SafeName(name) + '.url'), '[InternetShortcut]\r\nURL=' + real.replace(/[\r\n]/g, '') + '\r\n');
              }
            } else if (['assign', 'folder', 'page', 'book'].includes(mod)) {
              for (const f of await this.PluginFiles(http, url)) {
                if (await this.DownloadFile(http, f, target, keepImages)) saved++;
              }
            }
          } catch (ex) {
            failed++;
            this.Toast(name + ': ' + (ex.message || String(ex)), true);
          }
        }
        let summary = 'נשמרו ' + saved + ' קבצים';
        if (recordings > 0) summary += ' · ' + recordings + ' הקלטות בדרך';
        if (failed > 0) summary += ' · ' + failed + ' נכשלו';
        this.SectionStatus(course, num, summary, false, failed > 0);
      } catch (ex) {
        this.bringToFront('ui');
        this.SectionStatus(course, num, ex.message || String(ex), false, true);
      } finally {
        this.busySections.delete(key);
        this.RememberItems(course, items);
        this.SendSectionLocal(course, num);
        this.SendCourseLocal(course);
      }
    },

    // Returns a Moodle-authenticated HTTP helper using the Moodle WebView's cookies and User-Agent.
    async MoodleHttp() {
      await this.moodleLock.wait();
      try { await this.EnsureMoodle(true); }
      finally { this.moodleLock.release(); }

      const cookies = await this.moodle.cookies(C.MoodleBase);
      const cookieHeader = cookies.map(c => c.name + '=' + c.value).join('; ');
      const ua = this.moodle.userAgent;
      const headers = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      };
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      return {
        headers,
        async get(url) {
          return fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(1800000) });
        },
        async getString(url) {
          const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        },
      };
    },

    async DownloadFile(http, url, dir, keepImages, maxBytes = 0) {
      const resp = await http.get(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const finalUrl = resp.url || url;
      if (!IsMoodleUrl(finalUrl)) return null;
      const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (ct === 'text/html') return null;

      const u = new URL(finalUrl);
      const fromUrl = decodeURIComponent(u.pathname.split('/').pop() || '');
      let name = fromUrl;
      const cdName = parseContentDispositionFilename(resp.headers.get('content-disposition'));
      if (!fromUrl.includes('.') && cdName) name = cdName;
      name = SafeName(name);
      if (!keepImages && /^\.(png|jpe?g|gif|svg|css|js)$/i.test(path.extname(name))) return null;

      const outPath = path.join(dir, name);
      const clHeader = resp.headers.get('content-length');
      const length = clHeader !== null ? Number(clHeader) : null;
      if (maxBytes > 0 && length !== null && length > maxBytes) return null;
      if (fileExists(outPath) && length !== null && fs.statSync(outPath).size === length) return outPath;
      mkdirp(dir);
      const temp = outPath + '.part';
      try {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (maxBytes > 0 && buf.length > maxBytes) {
          throw new Error('קובץ גדול מדי לבדיקה אוטומטית; אפשר להוריד ידנית');
        }
        fs.writeFileSync(temp, buf);
      } catch (ex) {
        try { if (fileExists(temp)) fs.unlinkSync(temp); } catch { }
        throw ex;
      }
      fs.renameSync(temp, outPath);
      return outPath;
    },

    async PluginFiles(http, pageUrl) {
      const html = await http.getString(pageUrl);
      const found = [];
      const re = /href="(https:\/\/md\.hit\.ac\.il\/[^"]*pluginfile\.php\/[^"]+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const u = htmlDecode(m[1]);
        if (u.includes('/user/icon/') || u.includes('/course/overviewfiles/')) continue;
        if (!found.includes(u)) found.push(u);
      }
      return found;
    },

    async ResolveMoodleUrl(viewUrl) {
      const tcs = deferred();
      const onWillNav = (e, url) => {
        if (!url.toLowerCase().startsWith(C.MoodleBase.toLowerCase()) && url.startsWith('http')) {
          e.preventDefault();
          tcs.resolve(url);
        }
      };
      this.moodle.wc.on('will-navigate', onWillNav);
      this.moodle.wc.on('will-redirect', onWillNav);
      try {
        this.moodle.navigate(viewUrl);
        const raced = await Promise.race([tcs.promise, delay(8000).then(() => null)]);
        if (raced) return raced;
        const v = await this.EvalAsync(
          this.moodle,
          'const a=document.querySelector(\'.urlworkaround a, [role=main] a[href^="http"]:not([href*="md.hit.ac.il"])\');return a?a.href:"";',
          5000
        );
        return JSON.parse(v);
      } finally {
        this.moodle.wc.removeListener('will-navigate', onWillNav);
        this.moodle.wc.removeListener('will-redirect', onWillNav);
      }
    },
  },
};
