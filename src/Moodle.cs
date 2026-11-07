using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

partial class HitStudent
{
    const string DefaultMoodle = "https://md.hit.ac.il";
    static string moodleHostNow = "md.hit.ac.il"; // host of the Moodle in use, for the static URL checks

    // The student's Moodle (HIT by default). A friend at another institute types his own address once.
    string MoodleBase
    {
        get
        {
            string saved = Str(settings, "moodleUrl");
            string b = saved.Length == 0 && Str(settings, "institute") == "technion" ? TechnionMoodle : NormalizeMoodleUrl(saved);
            moodleHostNow = new Uri(b).Host;
            return b;
        }
    }

    // Keeps only "https://host[:port]" of whatever the student pasted; anything that is not a web address falls back to HIT.
    internal static string NormalizeMoodleUrl(string s)
    {
        s = (s ?? "").Trim();
        if (s.Length == 0) return DefaultMoodle;
        if (s.IndexOf("://", StringComparison.Ordinal) < 0) s = "https://" + s;
        Uri u;
        if (!Uri.TryCreate(s, UriKind.Absolute, out u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp) || u.Host.IndexOf('.') < 0) return DefaultMoodle;
        return "https://" + u.Authority;
    }
    const string Exercises = "תרגילים";                          // תרגילים
    const string Exams = "מבחנים";                                    // מבחנים
    const string CourseInfoFolder = "מידע על הקורס"; // מידע על הקורס
    const string General = "כללי";                                               // כללי
    const string RecordingFolder = "הקלטה";                                 // הקלטה (inside a lesson)
    const string LectureRecordings = "הקלטות";                              // הקלטות (course level, "הרצאה N")
    const string StudyPages = "דפי לימוד";                   // דפי לימוד
    const string Notebook = "מחברת תלמיד";                    // the student's own notebook (inside a lecture)
    const string LecturerNotes = "מחברת מרצה";                 // the lecturer's slides and notes (inside a lecture)
    const string SummaryHtmlName = "סיכום הרצאה - גרסה אינטראקטיבית.html";
    const string SummaryPdfName = "סיכום הרצאה.pdf";
    const string SumitDir = ".sumit";                          // the app's own helper files (digests, logs), hidden
    const string SummaryName = "סיכום הרצאה";                  // the lecture summary (.pdf / .html), inside the lecture folder                                         // מחברת
    const string LecturerProfile = "מבחנים\\פרופיל המרצה.md"; // פרופיל המרצה.md
    const string ExamPrepPage = "הכנה למבחן.html";   // לקראת המבחן.html
    const string CourseJson = ".hit-student-course.json";
    const string Cs24Folder = "CS24";
    const string PointersFolder = "עם מפנים";

    readonly SemaphoreSlim moodleLock = new SemaphoreSlim(1, 1);
    bool moodleCancelled;
    readonly HashSet<string> busySections = new HashSet<string>();
    readonly Dictionary<int, TaskCompletionSource<Dictionary<string, object>>> evals = new Dictionary<int, TaskCompletionSource<Dictionary<string, object>>>();
    int nextEvalId = 1;

    // ---------- Scripts inside the hidden browsers ----------

    async Task<string> EvalAsync(WebView2 view, string body, int timeoutMs)
    {
        int id = nextEvalId++;
        var tcs = new TaskCompletionSource<Dictionary<string, object>>();
        evals[id] = tcs;
        string script = "(async()=>{const __id=" + id + ";try{const __v=await (async()=>{" + body + "})();"
                      + "chrome.webview.postMessage({__rid:__id,ok:true,value:JSON.stringify(__v===undefined?null:__v)});}"
                      + "catch(e){chrome.webview.postMessage({__rid:__id,ok:false,value:String((e&&e.message)||e)});}})();";
        try
        {
            await view.CoreWebView2.ExecuteScriptAsync(script);
            var done = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs));
            if (done != tcs.Task) throw new Exception("הדף לא ענה בזמן");
            var m = tcs.Task.Result;
            if (!Bool(m, "ok")) throw new Exception(Str(m, "value"));
            return Str(m, "value");
        }
        finally { evals.Remove(id); }
    }

    void OnEvalMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        Uri src;
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out src)) return;
        string moodleHost = new Uri(MoodleBase).Host;
        if (!src.Host.EndsWith("hit.ac.il", StringComparison.OrdinalIgnoreCase) && !src.Host.Equals(moodleHost, StringComparison.OrdinalIgnoreCase) && !src.Host.EndsWith("zoom.us", StringComparison.OrdinalIgnoreCase)
            && !src.Host.Equals("cs24.co.il", StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            var m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            if (m == null || !m.ContainsKey("__rid")) return;
            TaskCompletionSource<Dictionary<string, object>> tcs;
            if (evals.TryGetValue(Int(m, "__rid"), out tcs)) tcs.TrySetResult(m);
        }
        catch { }
    }

    // ---------- Connection ----------

    void SendMoodle(string state, string message) { Send(new { type = "moodle", state = state, message = message }); }

    async void ConnectMoodle()
    {
        try
        {
            await moodleLock.WaitAsync();
            try { await EnsureMoodle(true); }
            finally { moodleLock.Release(); }
            LoadHome();
        }
        catch (Exception ex) { ui.BringToFront(); SendMoodle("error", ex.Message); }
    }

    // interactive=false never shows the sign-in page; it only reports whether a sign-in is needed.
    async Task EnsureMoodle(bool interactive)
    {
        if (await MoodleReady()) return;
        SendMoodle("connecting", "");
        moodleCancelled = false;
        moodle.CoreWebView2.Navigate(MoodleBase + "/my/");
        var clock = Stopwatch.StartNew();
        bool shown = false;
        while (true)
        {
            await Task.Delay(500);
            if (moodleCancelled)
            {
                moodleCancelled = false;
                SendMoodle("login", "");
                throw new Exception("ההתחברות ל-Moodle בוטלה");
            }
            if (await MoodleReady()) break;
            if (clock.Elapsed.TotalSeconds > 4 && !shown)
            {
                if (!interactive) { SendMoodle("login", ""); throw new Exception("צריך להתחבר ל-Moodle"); }
                shown = true;
                moodlePanel.BringToFront();
                SendMoodle("login", "");
            }
            if (clock.Elapsed.TotalMinutes > 10) throw new Exception("פג הזמן להתחברות");
        }
        ui.BringToFront();
        SendMoodle("ready", "");
    }

    async Task<bool> MoodleReady()
    {
        string src = moodle.Source == null ? "" : moodle.Source.ToString();
        if (!src.StartsWith(MoodleBase, StringComparison.OrdinalIgnoreCase) || src.IndexOf("/login/", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        try
        {
            // A guest on Moodle's front page also has a sesskey, so check that someone is actually signed in.
            string v = await EvalAsync(moodle, "return (typeof M!=='undefined'&&M.cfg&&M.cfg.sesskey&&document.body&&!document.body.classList.contains('notloggedin')&&!document.querySelector('a[href*=\"/login/index.php\"].btn, .usermenu .login'))?M.cfg.sesskey:'';", 4000);
            return json.Deserialize<string>(v).Length > 0;
        }
        catch { return false; }
    }

    // Keeps the Moodle session alive and reports its state without ever popping up a sign-in page.
    async Task<string> MoodleHeartbeat()
    {
        if (!await moodleLock.WaitAsync(0)) return "ready";
        try
        {
            if (await MoodleReady())
            {
                try
                {
                    string v = await EvalAsync(moodle, Ajax("core_session_touch", "{}"), 15000);
                    return "ready";
                }
                catch { }
            }
            try { await EnsureMoodle(false); return "ready"; }
            catch { return "login"; }
        }
        finally { moodleLock.Release(); }
    }

    async Task<T> WithMoodle<T>(Func<Task<T>> work)
    {
        await moodleLock.WaitAsync();
        try
        {
            await EnsureMoodle(true);
            return await work();
        }
        finally { moodleLock.Release(); }
    }

    // A student at another institute points the app at his own Moodle; what was saved from the previous one is dropped.
    void SetMoodleUrl(string url)
    {
        string next = NormalizeMoodleUrl(url);
        if (string.Equals(next, MoodleBase, StringComparison.OrdinalIgnoreCase)) { SendSettings(); return; }
        ApplyMoodleUrl(next);
    }

    void ApplyMoodleUrl(string next)
    {
        settings["moodleUrl"] = next;
        SaveSettings();
        var cache = ReadMoodleCache(); cache.Remove("courses"); cache.Remove("home");
        try { File.WriteAllText(MoodleCacheFile, json.Serialize(cache), Encoding.UTF8); } catch { }
        lastCourses = null; coursesFresh = false;
        string unused = MoodleBase; // refreshes the host for the static checks
        try { moodle.CoreWebView2.Navigate(next + "/my/"); } catch { }
        SendMoodle("login", "");
        SendSettings();
        Send(new { type = "courses", data = new List<Dictionary<string, object>>() });
    }

    // HIT or the Technion: the Moodle, the folder name and the extras follow. Folders that are still the empty defaults move to the new name;
    // anything the student already filled or chose himself stays where it is.
    void SetInstitute(string institute)
    {
        institute = institute == "technion" ? "technion" : "hit";
        if ((institute == "technion") == Technion) { SendSettings(); return; }
        string fromBrand = InstFolder;
        settings["institute"] = institute;
        string toBrand = InstFolder;
        string study = StudyRoot;
        if (IsFreshDefaultFolder(study, fromBrand))
        {
            string root = DefaultStudyRoot(Directory.Exists(@"D:\"), Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Technion);
            settings["studyRoot"] = root;
            if (IsFreshDefaultFolder(RecordingsDir, fromBrand)) settings["recordingsDir"] = Path.Combine(Path.GetDirectoryName(root), "הקלטות");
        }
        ApplyMoodleUrl(Technion ? TechnionMoodle : DefaultMoodle);
    }

    internal static bool IsFreshDefaultFolder(string path, string brand)
    {
        try
        {
            string p = (path ?? "").TrimEnd('\\');
            string parent = Path.GetDirectoryName(p);
            if (parent == null || !string.Equals(Path.GetFileName(parent), brand, StringComparison.OrdinalIgnoreCase)) return false;
            return !Directory.Exists(p) || !Directory.EnumerateFileSystemEntries(p).Any();
        }
        catch { return false; }
    }

    // Background reads never pop up the sign-in page: when Moodle is down or the session ran out, the caller keeps what is saved on this PC.
    async Task<T> WithMoodleQuiet<T>(Func<Task<T>> work)
    {
        await moodleLock.WaitAsync();
        try
        {
            await EnsureMoodle(false);
            return await work();
        }
        finally { moodleLock.Release(); }
    }

    // The last course list and home page that Moodle gave, so the courses open even while Moodle is unreachable.
    string MoodleCacheFile { get { return Path.Combine(AppDir, "moodle-cache.json"); } }

    Dictionary<string, object> ReadMoodleCache()
    {
        try { if (File.Exists(MoodleCacheFile)) return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(MoodleCacheFile, Encoding.UTF8)) ?? new Dictionary<string, object>(); }
        catch { }
        return new Dictionary<string, object>();
    }

    void WriteMoodleCache(string key, object value)
    {
        try
        {
            var all = ReadMoodleCache();
            all[key] = value;
            File.WriteAllText(MoodleCacheFile, json.Serialize(all), Encoding.UTF8);
        }
        catch { }
    }

    // A course the student added himself (not from Moodle, e.g. a course from the internet): just a folder with a mark in its info file.
    List<Dictionary<string, object>> ManualCourses()
    {
        var res = new List<Dictionary<string, object>>();
        try
        {
            if (StudyRoot.Length > 0 && Directory.Exists(StudyRoot))
                foreach (string d in Directory.GetDirectories(StudyRoot))
                {
                    string name = Path.GetFileName(d);
                    if (!Bool(LoadMeta(name), "manual")) continue;
                    int id = 0; foreach (char ch in name) id = (id * 31 + ch) % 90000;
                    res.Add(new Dictionary<string, object> { { "id", -(id + 1) }, { "name", name }, { "short", name }, { "category", "קורס שהוספתי" }, { "current", true }, { "progress", null }, { "url", "" }, { "manual", true } });
                }
        }
        catch { }
        return res;
    }

    List<Dictionary<string, object>> WithManualCourses(List<Dictionary<string, object>> moodleCourses)
    {
        var all = new List<Dictionary<string, object>>(moodleCourses ?? new List<Dictionary<string, object>>());
        foreach (var m in ManualCourses()) if (!all.Any(c => Str(c, "name") == Str(m, "name"))) all.Add(m);
        return all;
    }

    void AddManualCourse(string name)
    {
        name = SafeName((name ?? "").Trim());
        if (name.Length == 0) { Toast("כתוב שם לקורס", true); return; }
        if (StudyRoot.Length == 0) { Toast("בחר קודם תיקיית קורסים בהגדרות", true); return; }
        if (Directory.Exists(CourseDir(name)) && !Bool(LoadMeta(name), "manual")) { Toast("כבר יש תיקייה בשם הזה", true); return; }
        Directory.CreateDirectory(CourseDir(name));
        var meta = LoadMeta(name); meta["manual"] = true; meta["setupDone"] = true; SaveMeta(name, meta);
        Toast("הקורס נוסף: " + name, false);
        lastCourses = null; LoadCourses(true);
    }

    // Courses saved earlier; failing that, the course folders on disk that remember their Moodle id.
    List<Dictionary<string, object>> OfflineCourses()
    {
        var res = new List<Dictionary<string, object>>();
        try
        {
            var all = ReadMoodleCache();
            if (all.ContainsKey("courses")) res = json.Deserialize<List<Dictionary<string, object>>>(json.Serialize(all["courses"])) ?? res;
        }
        catch { }
        if (res.Count > 0) return WithManualCourses(res);
        try
        {
            if (StudyRoot.Length > 0 && Directory.Exists(StudyRoot))
                foreach (string d in Directory.GetDirectories(StudyRoot))
                {
                    string name = Path.GetFileName(d);
                    var meta = LoadMeta(name);
                    if (!meta.ContainsKey("courseId")) continue;
                    res.Add(new Dictionary<string, object> { { "id", Int(meta, "courseId") }, { "name", name }, { "short", name }, { "category", "" }, { "current", true }, { "progress", null }, { "url", "" } });
                }
        }
        catch { }
        return WithManualCourses(res);
    }

    static string Ajax(string method, string argsJson)
    {
        return "const r=await fetch('/lib/ajax/service.php?sesskey='+M.cfg.sesskey+'&info=" + method + "',{method:'POST',headers:{'Content-Type':'application/json'},"
             + "body:JSON.stringify([{index:0,methodname:'" + method + "',args:" + argsJson + "}])});const j=await r.json();"
             + "if(j[0].error) throw new Error((j[0].exception&&j[0].exception.message)||'Moodle error');return j[0].data;";
    }

    // ---------- Moodle data ----------

    const string CoursesJs = @"
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
  current: ids.has(c.id), progress: c.hasprogress ? c.progress : null, url: c.viewurl}));";

    const string HomeJs = @"
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
return {events, name};";

    // Lecturers from the participants list, by the role written in each row (Moodle 4 ignores ?roleid=).
    const string LecturerJs = @"
const lecturers = [], assistants = [];
const nameOf = (a) => { const c = a.cloneNode(true); c.querySelectorAll('.userinitials, .userpicture, img, .sr-only, .visually-hidden').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
try {
  const doc = new DOMParser().parseFromString(await (await fetch('/user/index.php?id=' + COURSE_ID + '&perpage=5000')).text(), 'text/html');
  doc.querySelectorAll('table tbody tr').forEach(tr => {
    const a = tr.querySelector('a[href*=""/user/view.php""]');
    if (!a) return;
    const name = nameOf(a);
    const roles = [...tr.querySelectorAll('td')].map(td => td.textContent).join(' ');
    if (!name) return;
    if (/מרצה|editing ?teacher|\bteacher\b|מורה/i.test(roles) && !/סטודנט|student/i.test(roles)) lecturers.push(name);
    else if (/מתרגל|assistant|non-editing/i.test(roles)) assistants.push(name);
  });
} catch (e) {}
if (!lecturers.length) {
  try {
    const doc = new DOMParser().parseFromString(await (await fetch('/course/info.php?id=' + COURSE_ID)).text(), 'text/html');
    doc.querySelectorAll('.teachers a, .course-contacts a, ul.teachers li a').forEach(a => lecturers.push(nameOf(a)));
  } catch (e) {}
}
return [...new Set(lecturers)].slice(0, 3);";

    // Reads the course page (and any per-section pages) into sections of activities.
    const string SectionsJs = @"
const base = location.origin;
const abs = (h) => { try { return new URL(h, base).href; } catch (e) { return null; } };
const clean = (el) => {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.accesshide, .sr-only, .visually-hidden, button, .icons-collapse-expand, [data-toggle=""collapse""], [data-bs-toggle=""collapse""]').forEach(x => x.remove());
  return c.textContent.replace(/תצוגה מצומצמת|תצוגה מורחבת|Collapse|Expand/g, '').replace(/\s+/g, ' ').trim();
};
const load = async (url) => new DOMParser().parseFromString(await (await fetch(url, {credentials: 'include'})).text(), 'text/html');
const readItems = (root) => {
  const items = [], seen = new Set();
  root.querySelectorAll('li.activity').forEach(a => {
    const link = a.querySelector('a.aalink, .activityname a, a[href*=""/mod/""]');
    const mod = ((a.className.match(/modtype_(\w+)/) || [])[1]) || '';
    const name = clean(a.querySelector('.instancename, .activityname')) || clean(link);
    const url = link ? abs(link.getAttribute('href')) : null;
    const dates = clean(a.querySelector('[data-region=""activity-dates""], .activity-dates'));
    if (mod === 'label') {
      a.querySelectorAll('a[href]').forEach(x => {
        const h = abs(x.getAttribute('href'));
        if (!h || seen.has(h)) return;
        if (/zoom\.us\/rec/i.test(h)) { seen.add(h); items.push({mod: 'zoom', name: clean(x) || 'Zoom', url: h}); }
        else if (/pluginfile\.php/i.test(h)) { seen.add(h); items.push({mod: 'file', name: clean(x) || decodeURIComponent(h.split('/').pop().split('?')[0]), url: h}); }
      });
      return;
    }
    if (url && !seen.has(url)) { seen.add(url); items.push({mod, name, url, dates}); }
  });
  root.querySelectorAll('.summary a[href], .summarytext a[href], [data-for=""sectioninfo""] a[href]').forEach(x => {
    const h = abs(x.getAttribute('href'));
    if (!h || seen.has(h)) return;
    if (/zoom\.us\/rec/i.test(h)) { seen.add(h); items.push({mod: 'zoom', name: clean(x) || 'Zoom', url: h}); }
    else if (/pluginfile\.php/i.test(h)) { seen.add(h); items.push({mod: 'file', name: clean(x) || decodeURIComponent(h.split('/').pop().split('?')[0]), url: h}); }
  });
  return items;
};
const doc = await load('/course/view.php?id=' + COURSE_ID);
let nodes = [...doc.querySelectorAll('li.section, li[data-for=""section""]')];
nodes = nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
const out = [];
for (let i = 0; i < nodes.length; i++) {
  const s = nodes[i];
  const numAttr = s.getAttribute('data-number') ?? s.getAttribute('data-sectionnum') ?? (s.id || '').replace('section-', '');
  const num = /^\d+$/.test(numAttr) ? parseInt(numAttr) : i;
  const title = clean(s.querySelector('.sectionname, [data-for=""section_title""], h3')) || ('יחידה ' + num);
  const summary = clean(s.querySelector('.summary, .summarytext, [data-for=""sectioninfo""]')).slice(0, 400);
  let items = readItems(s);
  if (!items.length) {
    const more = s.querySelector('a[href*=""section.php""], a[href*=""&section=""]');
    if (more) { try { items = readItems(await load(abs(more.getAttribute('href')))); } catch (e) {} }
  }
  out.push({num, title, summary, items});
}
return out;";

    List<Dictionary<string, object>> lastCourses;
    bool coursesFresh; // the list came from Moodle in this run (not from the copy saved on this PC)

    // cachedOnly: just show what is saved on this PC (used while Moodle is unreachable); never touches Moodle.
    async void LoadCourses(bool cachedOnly = false)
    {
        try
        {
            // The saved list appears at once; the fresh one replaces it when Moodle answers.
            var saved = OfflineCourses();
            if (saved.Count > 0)
            {
                if (lastCourses == null) lastCourses = saved;
                foreach (var c in saved) c["local"] = CourseLocal(Str(c, "name"));
                Send(new { type = "courses", data = saved, cached = true });
            }
            if (cachedOnly) return;
            string v = null;
            Exception fail = null;
            try { v = saved.Count > 0 ? await WithMoodleQuiet(() => EvalAsync(moodle, CoursesJs, 60000)) : await WithMoodle(() => EvalAsync(moodle, CoursesJs, 60000)); }
            catch (Exception ex) { fail = ex; }
            if (fail != null)
            {
                if (saved.Count > 0) return; // Moodle is down or the session ran out: keep working from what is saved
                throw fail;
            }
            lastCourses = json.Deserialize<List<Dictionary<string, object>>>(v);
            coursesFresh = true;
            WriteMoodleCache("courses", json.DeserializeObject(v));
            lastCourses = WithManualCourses(lastCourses);
            foreach (var c in lastCourses) c["local"] = CourseLocal(Str(c, "name"));
            Send(new { type = "courses", data = lastCourses });
        }
        catch (Exception ex) { ui.BringToFront(); SendMoodle("error", ex.Message); }
    }

    async void LoadHome()
    {
        try
        {
            var all = ReadMoodleCache();
            bool haveSaved = all.ContainsKey("home");
            string v = null;
            Exception fail = null;
            try { v = haveSaved ? await WithMoodleQuiet(() => EvalAsync(moodle, HomeJs, 60000)) : await WithMoodle(() => EvalAsync(moodle, HomeJs, 60000)); }
            catch (Exception ex) { fail = ex; }
            Dictionary<string, object> home;
            if (fail != null)
            {
                if (!haveSaved) throw fail;
                home = json.Deserialize<Dictionary<string, object>>(json.Serialize(all["home"])); // Moodle unreachable: the last known week
            }
            else
            {
                home = json.Deserialize<Dictionary<string, object>>(v);
                WriteMoodleCache("home", json.DeserializeObject(v));
            }
            string name = Str(home, "name");
            if (name.Length > 0 && name != Str(settings, "userName")) { settings["userName"] = name; SaveSettings(); }
            Send(new { type = "home", events = home["events"], name = name });
            if (!coursesFresh) LoadCourses(fail != null);
        }
        catch (Exception ex) { ui.BringToFront(); SendMoodle("error", ex.Message); }
    }

    async void OpenCourse(int id, string name)
    {
        try
        {
            // A course the student added himself has no Moodle: its lessons are the ones he made here.
            if (Bool(LoadMeta(name), "manual"))
            {
                var mm = LoadMeta(name);
                Send(new
                {
                    type = "course", id = id, name = name, folder = CourseDir(name), sections = new ArrayList(),
                    lecturer = Str(mm, "lecturer"), lecturerGuess = new ArrayList(), local = CourseLocal(name), notability = NotabilityInfo(name), manual = true
                });
                return;
            }
            // Show the last known lessons at once; the fresh list from Moodle follows a moment later.
            var cachedMeta = LoadMeta(name);
            var cached = cachedMeta.ContainsKey("sectionsCache") ? cachedMeta["sectionsCache"] as ArrayList : null;
            {
                foreach (Dictionary<string, object> s in cached ?? new ArrayList()) s["local"] = LocalInfo(name, Int(s, "num"));
                Send(new
                {
                    type = "course", id = id, name = name, folder = CourseDir(name), sections = cached ?? new ArrayList(), cached = true,
                    lecturer = Str(cachedMeta, "lecturer"), lecturerGuess = cachedMeta.ContainsKey("lecturerGuess") ? cachedMeta["lecturerGuess"] : new ArrayList(),
                    local = CourseLocal(name), notability = NotabilityInfo(name)
                });
            }

            // A course that is already on this PC opens without Moodle: no sign-in page, no error when Moodle is down.
            bool haveLocal = cached != null || Directory.Exists(CourseDir(name));
            string v = null;
            Exception fail = null;
            try { v = haveLocal ? await WithMoodleQuiet(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", id.ToString()), 120000)) : await WithMoodle(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", id.ToString()), 120000)); }
            catch (Exception ex) { fail = ex; }
            if (fail != null)
            {
                if (haveLocal) return;
                throw fail;
            }
            var sections = json.Deserialize<List<Dictionary<string, object>>>(v);
            var meta = LoadMeta(name);
            meta["courseId"] = id;
            meta["sectionsCache"] = json.DeserializeObject(v);
            if (Str(meta, "lecturer").Length == 0 && !meta.ContainsKey("lecturerGuess"))
            {
                try
                {
                    string lv = await WithMoodleQuiet(() => EvalAsync(moodle, LecturerJs.Replace("COURSE_ID", id.ToString()), 40000));
                    meta["lecturerGuess"] = json.Deserialize<List<string>>(lv);
                }
                catch { meta["lecturerGuess"] = new List<string>(); }
            }
            SaveMeta(name, meta);
            foreach (var s in sections) s["local"] = LocalInfo(name, Int(s, "num"));
            CheckNewMaterial(name, sections, false);
            Send(new
            {
                type = "course", id = id, name = name, folder = CourseDir(name), sections = sections,
                lecturer = Str(meta, "lecturer"), lecturerGuess = meta["lecturerGuess"], local = CourseLocal(name),
                notability = NotabilityInfo(name)
            });
        }
        catch (Exception ex) { ui.BringToFront(); Send(new { type = "courseError", id = id, message = ex.Message }); }
    }

    // ---------- Course folders ----------

    string CourseDir(string course) { return Path.Combine(StudyRoot, SafeName(course)); }

    static string LectureFolderName(int num)
    {
        return num == 0 ? General : Path.Combine("הרצאות", "הרצאה " + num); // שיעור N
    }

    string LectureDir(string course, int num) { return Path.Combine(CourseDir(course), LectureFolderName(num)); }

    string StudyPagePath(string course, int num)
    {
        return Path.Combine(LectureDir(course, num), SummaryName, SummaryHtmlName);
    }

    // Files the app writes into a lecture folder itself (the summary and its helpers): not the student's material.
    static bool IsSummaryFile(string path)
    {
        return Path.GetFileName(path).StartsWith(".") || path.Contains("\\" + SummaryName + "\\");
    }

    static int CountFiles(string dir)
    {
        return Directory.Exists(dir) ? Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Count(f => !Path.GetFileName(f).StartsWith(".")) : 0;
    }

    object LocalInfo(string course, int num)
    {
        string dir = LectureDir(course, num);
        int files = 0, videos = 0, transcripts = 0;
        if (Directory.Exists(dir))
        {
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            {
                string ext = Path.GetExtension(f).ToLowerInvariant();
                if (ext == ".mp4" && string.Equals(Path.GetDirectoryName(f), Path.Combine(dir, RecordingFolder), StringComparison.OrdinalIgnoreCase)) videos++;
                else if (f.EndsWith(TranscriptSuffix + ".txt")) transcripts++;
                else if (!IsSummaryFile(f) && !f.Contains("\\" + PointersFolder + "\\")) files++;
            }
        }
        string page = StudyPagePath(course, num);
        string exercisesDir = Path.Combine(dir, Exercises);
        string pointersDir = Path.Combine(exercisesDir, PointersFolder);
        var pointers = Directory.Exists(pointersDir) ? Directory.GetFiles(pointersDir, "*.pdf").Select(p => new { name = Path.GetFileNameWithoutExtension(p), path = p }).ToList<object>() : new List<object>();
        int exercises = Directory.Exists(exercisesDir) ? Directory.GetFiles(exercisesDir).Length : 0;
        string recDir = Path.Combine(dir, RecordingFolder);
        var recordingFiles = Directory.Exists(recDir) ? Directory.GetFiles(recDir)
            .Where(f => new[] { ".mp4", ".webm", ".mkv", ".m4a" }.Contains(Path.GetExtension(f).ToLowerInvariant()))
            .Select(f => new { name = Path.GetFileNameWithoutExtension(f), ext = Path.GetExtension(f).ToLowerInvariant(), path = f,
                transcript = File.Exists(Path.Combine(recDir, Path.GetFileNameWithoutExtension(f) + " " + TranscriptSuffix + ".txt")) }).ToList<object>() : new List<object>();
        var materialFiles = Directory.Exists(dir) ? Directory.GetFiles(dir, "*", SearchOption.AllDirectories)
            .Where(f => !IsSummaryFile(f) && !f.Contains("\\" + PointersFolder + "\\") && !f.StartsWith(recDir + "\\", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f).Select(f => new { name = f.Substring(dir.Length + 1), path = f }).ToList<object>() : new List<object>();
        return new
        {
            dir = dir, exists = Directory.Exists(dir), files = files, videos = recordingFiles.Count, transcripts = transcripts, recordings = recordingFiles,
            sharedSummaries = SharedSummaries(course,num), studyPage = File.Exists(page) ? page : null, exercises = exercises, pointers = pointers, materialFiles = materialFiles,
            lecturePdf = File.Exists(LecturePdfPath(course, num)) ? LecturePdfPath(course, num) : null
        };
    }

    object CourseLocal(string course)
    {
        string dir = CourseDir(course);
        string info = Path.Combine(dir, CourseJson);
        object courseInfo = null;
        try { if (File.Exists(info)) courseInfo = json.DeserializeObject(File.ReadAllText(info, Encoding.UTF8)); } catch { }
        string lecturesDir = Path.Combine(dir, "הרצאות");
        var lectureFolders = Directory.Exists(lecturesDir) ? Directory.GetDirectories(lecturesDir, "הרצאה *") : new string[0];
        int pageCount = lectureFolders.Count(d => File.Exists(Path.Combine(d, SummaryName, SummaryHtmlName)));
        int pdfCount = lectureFolders.Count(d => File.Exists(Path.Combine(d, SummaryName, SummaryPdfName)));
        string prep = Path.Combine(dir, Exams, ExamPrepPage);
        string profile = Path.Combine(dir, LecturerProfile);
        return new
        {
            dir = dir, exists = Directory.Exists(dir), exams = CountFiles(Path.Combine(dir, Exams)), infoFiles = CountFiles(Path.Combine(dir, CourseInfoFolder)),
            infoText = File.Exists(Path.Combine(dir, CourseInfoFolder + ".md")) ? ReadCapped(Path.Combine(dir, CourseInfoFolder + ".md"),60000) : null,
            notes = CountFiles(Path.Combine(dir, Notebook)), cs24 = CountFiles(Path.Combine(dir, Cs24Folder)), studyPages = pageCount, info = courseInfo,
            lecturePdfs = pdfCount,
            examPrep = File.Exists(prep) ? prep : null, lecturerProfile = File.Exists(profile) ? profile : null,
            courseInfoMd = File.Exists(Path.Combine(dir, CourseInfoFolder + ".md")) ? Path.Combine(dir, CourseInfoFolder + ".md") : null,
            examsSkipped = Bool(LoadMeta(course), "examsSkipped"), background = BackgroundFor(course),
            setupDone = true, lectures = ManualLectures(course), lectureCalendar = LoadMeta(course).ContainsKey("lectureCalendar") ? LoadMeta(course)["lectureCalendar"] : null,
            lectureRecordings = Directory.Exists(Path.Combine(dir, LectureRecordings))
                ? Directory.GetFiles(Path.Combine(dir, LectureRecordings), "*.mp4").OrderBy(f => f).Select(f => new { name = Path.GetFileNameWithoutExtension(f), path = f }).ToList<object>()
                : new List<object>()
        };
    }

    void SendSectionLocal(string course, int num)
    {
        Send(new { type = "sectionLocal", course = course, num = num, local = LocalInfo(course, num) });
    }

    void SendCourseLocal(string course)
    {
        Send(new { type = "courseLocal", course = course, local = CourseLocal(course), notability = NotabilityInfo(course) });
    }

    void SectionStatus(string course, int num, string text, bool busy, bool error)
    {
        Send(new { type = "sectionStatus", course = course, num = num, text = text, busy = busy, error = error });
    }

    Dictionary<string, object> LoadMeta(string course)
    {
        string file = Path.Combine(CourseDir(course), ".hit-student.json");
        try { if (File.Exists(file)) return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) ?? new Dictionary<string, object>(); }
        catch { }
        return new Dictionary<string, object>();
    }

    void SaveMeta(string course, Dictionary<string, object> meta)
    {
        string dir = CourseDir(course);
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, ".hit-student.json");
        try
        {
            if (File.Exists(file)) File.SetAttributes(file, FileAttributes.Normal);
            File.WriteAllText(file, json.Serialize(meta), Encoding.UTF8);
            File.SetAttributes(file, FileAttributes.Hidden);
        }
        catch { }
    }

    void AddFiles(string course, string folder, string kind = "")
    {
        using (var dlg = new OpenFileDialog { Multiselect = true, Title = "הוסף קבצים" })
        {
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            // "folder" is either a lecture number or one of the course-level folders (מבחנים, מידע על הקורס).
            int num;
            string dir = int.TryParse(folder, out num) ? LectureDir(course, num)
                       : Path.Combine(CourseDir(course), folder == CourseInfoFolder ? CourseInfoFolder : Exams);
            foreach (string f in dlg.FileNames)
            {
                string name = Path.GetFileName(f);
                string target = int.TryParse(folder, out num) ? LectureSubdir(dir, kind, name) : dir;
                Directory.CreateDirectory(target);
                string dest = Path.Combine(target, SafeName(name));
                if (string.Equals(Path.GetFullPath(f), Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase)) continue;
                for (int suffix = 2; File.Exists(dest); suffix++)
                    dest = Path.Combine(target, SafeName(Path.GetFileNameWithoutExtension(name)) + " (" + suffix + ")" + Path.GetExtension(name));
                File.Copy(f, dest, false);
            }
            if (int.TryParse(folder, out num)) SendSectionLocal(course, num);
            SendCourseLocal(course);
            Toast(dlg.FileNames.Length + " קבצים נוספו", false);
        }
    }

    static readonly Regex ExerciseName = new Regex(
        "(תרגיל|תרגול|פתרון|פתרונות|שיעורי בית|מטלה|ש\"ב|targ|tirgul|solut|homework|\\bhw|exercise|assignment|\\bsol)",
        RegexOptions.IgnoreCase);
    static readonly Regex ExamName = new Regex(
        "(מבחן|מבחנ|בחינ|מועד [אבג]|שנים קודמות|\\bexam|midterm|\\bfinal)",
        RegexOptions.IgnoreCase);
    static readonly Regex SyllabusName = new Regex(
        "(סילבוס|סילב|syllabus|syllabi|סילאבוס|course outline|course description|תוכנית הקורס|תכנית הקורס|מידע על הקורס|דרישות הקורס|מבנה הציון)",
        RegexOptions.IgnoreCase);

    static bool IsExercise(string name) { return ExerciseName.IsMatch(name ?? ""); }

    // Inside a lecture folder: homework -> תרגילים, the student's notebook -> מחברת תלמיד, everything else -> מחברת מרצה.
    static string LectureSubdir(string lectureDir, string kind, string fileName)
    {
        if (kind == "homework" || (string.IsNullOrEmpty(kind) && IsExercise(fileName)) || (kind == "slides" && IsExercise(fileName))) return Path.Combine(lectureDir, Exercises);
        if (kind == "notes") return Path.Combine(lectureDir, Notebook);
        return Path.Combine(lectureDir, LecturerNotes);
    }

    // Where a Moodle item belongs: exams and the syllabus go to course-level folders, the rest to the lecture.
    string TargetFor(string course, int num, string mod, string name)
    {
        if (SyllabusName.IsMatch(name)) return Path.Combine(CourseDir(course), CourseInfoFolder);
        if (ExamName.IsMatch(name)) return Path.Combine(CourseDir(course), Exams);
        string dir = LectureDir(course, num);
        return mod == "assign" ? Path.Combine(dir, Exercises) : LectureSubdir(dir, "", name);
    }

    // ---------- Downloading from Moodle ----------

    static bool IsMoodleUrl(string url)
    {
        Uri u;
        return Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == Uri.UriSchemeHttps && u.Host.Equals(moodleHostNow, StringComparison.OrdinalIgnoreCase);
    }

    static bool IsZoomUrl(string url)
    {
        Uri u;
        return Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == Uri.UriSchemeHttps
            && (u.Host.Equals("zoom.us", StringComparison.OrdinalIgnoreCase) || u.Host.EndsWith(".zoom.us", StringComparison.OrdinalIgnoreCase))
            && u.AbsolutePath.StartsWith("/rec/", StringComparison.OrdinalIgnoreCase);
    }

    readonly HashSet<string> syncingCourses = new HashSet<string>();

    async void SyncCourse(string course, ArrayList sections) { await SyncCourseAsync(course, sections); }

    // First run: download every course the student picked, one after another, in the background.
    async void PrepareCourses(ArrayList courses)
    {
        if (courses == null) return;
        var list = courses.Cast<Dictionary<string, object>>().ToList();
        for (int i = 0; i < list.Count; i++)
        {
            string name = Str(list[i], "name");
            int id = Int(list[i], "id");
            Send(new { type = "prepStatus", busy = true, done = i, total = list.Count, course = name });
            try
            {
                string v = await WithMoodle(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", id.ToString()), 120000));
                var meta = LoadMeta(name);
                meta["courseId"] = id;
                SaveMeta(name, meta);
                await SyncCourseAsync(name, json.Deserialize<ArrayList>(v));
            }
            catch (Exception ex) { Toast(name + ": " + ex.Message, true); }
        }
        Send(new { type = "prepStatus", busy = false, done = list.Count, total = list.Count });
        if (lastCourses != null) foreach (var c in lastCourses) c["local"] = CourseLocal(Str(c, "name"));
        if (lastCourses != null) Send(new { type = "courses", data = lastCourses });
    }

    // Downloads every lesson of the course. Files already on disk are skipped, so this is cheap to repeat.
    async Task SyncCourseAsync(string course, ArrayList sections)
    {
        if (sections == null || !syncingCourses.Add(course)) return;
        try
        {
            var list = sections.Cast<Dictionary<string, object>>().ToList();
            // Progress is weighted by how many items each lesson has, so the bar moves evenly.
            Func<Dictionary<string, object>, int> weight = s => 1 + (s.ContainsKey("items") && s["items"] is ArrayList ? ((ArrayList)s["items"]).Count : 0);
            int total = list.Sum(weight), done = 0;
            for (int i = 0; i < list.Count; i++)
            {
                int before = done;
                await SyncSectionAsync(course, list[i], (k, item) => Progress(course, "מוריד מה-Moodle: " + Trunc(item, 70), (double)(before + 1 + k) / total));
                done += weight(list[i]);
            }
            Send(new { type = "courseStatus", course = course, busy = false, text = "", synced = true });
        }
        finally { syncingCourses.Remove(course); }
    }

    async void SyncSection(string course, Dictionary<string, object> section) { await SyncSectionAsync(course, section); }

    async Task SyncSectionAsync(string course, Dictionary<string, object> section, Action<int, string> onItem = null)
    {
        if (section == null) return;
        int num = Int(section, "num");
        string key = course + "|" + num;
        if (!busySections.Add(key)) return;

        var items = (section["items"] as ArrayList ?? new ArrayList()).Cast<Dictionary<string, object>>().ToList();
        int saved = 0, recordings = 0, failed = 0;
        try
        {
            SectionStatus(course, num, "מתחבר ל-Moodle...", true, false);
            Directory.CreateDirectory(LectureDir(course, num));
            using (var http = await MoodleHttp())
            {
                for (int i = 0; i < items.Count; i++)
                {
                    var it = items[i];
                    string mod = Str(it, "mod"), name = Str(it, "name"), url = Str(it, "url");
                    SectionStatus(course, num, "מוריד " + (i + 1) + "/" + items.Count + ": " + name, true, false);
                    if (onItem != null) onItem(i, name);
                    string target = TargetFor(course, num, mod, name);
                    bool keepImages = mod == "assign" || IsExercise(name);
                    try
                    {
                        if (mod == "zoom")
                        {
                            // Recordings are added only by the student.
                            continue;
                        }
                        if (!IsMoodleUrl(url)) continue;
                        if (mod == "resource")
                        {
                            if (await DownloadFile(http, url + (url.Contains("?") ? "&" : "?") + "redirect=1", target, keepImages) != null) saved++;
                        }
                        else if (mod == "file")
                        {
                            if (await DownloadFile(http, url, target, keepImages) != null) saved++;
                        }
                        else if (mod == "url")
                        {
                            string real = await WithMoodle(() => ResolveMoodleUrl(url));
                            if (IsZoomUrl(real)) { /* Manual recordings only. */ }
                            else if (real.StartsWith("https://") || real.StartsWith("http://"))
                                File.WriteAllText(Path.Combine(LectureDir(course, num), SafeName(name) + ".url"), "[InternetShortcut]\r\nURL=" + real.Replace("\r", "").Replace("\n", "") + "\r\n");
                        }
                        else if (mod == "assign" || mod == "folder" || mod == "page" || mod == "book")
                        {
                            foreach (string f in await PluginFiles(http, url))
                                if (await DownloadFile(http, f, target, keepImages) != null) saved++;
                        }
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        Toast(name + ": " + ex.Message, true);
                    }
                }
            }
            string summary = "נשמרו " + saved + " קבצים";
            if (recordings > 0) summary += " · " + recordings + " הקלטות בדרך";
            if (failed > 0) summary += " · " + failed + " נכשלו";
            SectionStatus(course, num, summary, false, failed > 0);
        }
        catch (Exception ex)
        {
            ui.BringToFront();
            SectionStatus(course, num, ex.Message, false, true);
        }
        finally
        {
            busySections.Remove(key);
            RememberItems(course, items);
            SendSectionLocal(course, num);
            SendCourseLocal(course);
        }
    }

    async Task<HttpClient> MoodleHttp()
    {
        await moodleLock.WaitAsync();
        try { await EnsureMoodle(true); }
        finally { moodleLock.Release(); }

        var jar = new CookieContainer();
        foreach (var c in await moodle.CoreWebView2.CookieManager.GetCookiesAsync(MoodleBase))
        {
            try { jar.Add(new Cookie(c.Name, c.Value, c.Path, c.Domain)); } catch { }
        }
        var http = new HttpClient(new HttpClientHandler { CookieContainer = jar, AllowAutoRedirect = true, UseCookies = true });
        http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", moodle.CoreWebView2.Settings.UserAgent);
        http.Timeout = TimeSpan.FromMinutes(30);
        return http;
    }

    async Task<string> DownloadFile(HttpClient http, string url, string dir, bool keepImages, long maxBytes = 0)
    {
        using (var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
        {
            if (!resp.IsSuccessStatusCode) throw new Exception("HTTP " + (int)resp.StatusCode);
            if (!IsMoodleUrl(resp.RequestMessage.RequestUri.AbsoluteUri)) return null; // redirected off Moodle
            var ct = resp.Content.Headers.ContentType;
            if (ct != null && ct.MediaType == "text/html") return null;                 // a Moodle page, not a file

            string fromUrl = Uri.UnescapeDataString(resp.RequestMessage.RequestUri.AbsolutePath.Split('/').Last());
            string name = fromUrl;
            var cd = resp.Content.Headers.ContentDisposition;
            if (!fromUrl.Contains(".") && cd != null) name = (cd.FileNameStar ?? cd.FileName ?? fromUrl).Trim('"');
            name = SafeName(name);
            if (!keepImages && Regex.IsMatch(Path.GetExtension(name), @"^\.(png|jpe?g|gif|svg|css|js)$", RegexOptions.IgnoreCase)) return null;

            string path = Path.Combine(dir, name);
            long? length = resp.Content.Headers.ContentLength;
            if (maxBytes > 0 && length > maxBytes) return null;
            if (File.Exists(path) && length.HasValue && new FileInfo(path).Length == length.Value) return path;
            Directory.CreateDirectory(dir);
            string temp = path + ".part";
            try {
                using (var input = await resp.Content.ReadAsStreamAsync()) using (var fs = File.Create(temp)) {
                    byte[] buffer = new byte[81920]; long total = 0; int read;
                    while ((read = await input.ReadAsync(buffer, 0, buffer.Length)) > 0) {
                        total += read; if (maxBytes > 0 && total > maxBytes) throw new IOException("קובץ גדול מדי לבדיקה אוטומטית; אפשר להוריד ידנית");
                        await fs.WriteAsync(buffer, 0, read);
                    }
                }
            } catch { if (File.Exists(temp)) File.Delete(temp); throw; }
            if (File.Exists(path)) File.Delete(path);
            File.Move(temp, path);
            return path;
        }
    }

    async Task<List<string>> PluginFiles(HttpClient http, string pageUrl)
    {
        string html = await http.GetStringAsync(pageUrl);
        var found = new List<string>();
        foreach (Match mt in Regex.Matches(html, "href=\"(https://md\\.hit\\.ac\\.il/[^\"]*pluginfile\\.php/[^\"]+)\""))
        {
            string u = WebUtility.HtmlDecode(mt.Groups[1].Value);
            if (u.Contains("/user/icon/") || u.Contains("/course/overviewfiles/")) continue;
            if (!found.Contains(u)) found.Add(u);
        }
        return found;
    }

    async Task<string> ResolveMoodleUrl(string viewUrl)
    {
        var tcs = new TaskCompletionSource<string>();
        EventHandler<CoreWebView2NavigationStartingEventArgs> watch = (s, e) =>
        {
            if (!e.Uri.StartsWith(MoodleBase, StringComparison.OrdinalIgnoreCase) && e.Uri.StartsWith("http"))
            {
                e.Cancel = true;
                tcs.TrySetResult(e.Uri);
            }
        };
        moodle.CoreWebView2.NavigationStarting += watch;
        try
        {
            moodle.CoreWebView2.Navigate(viewUrl);
            var done = await Task.WhenAny(tcs.Task, Task.Delay(8000));
            if (done == tcs.Task) return tcs.Task.Result;
            string v = await EvalAsync(moodle,
                "const a=document.querySelector('.urlworkaround a, [role=main] a[href^=\"http\"]:not([href*=\"" + new Uri(MoodleBase).Host + "\"])');return a?a.href:'';", 5000);
            return json.Deserialize<string>(v);
        }
        finally { moodle.CoreWebView2.NavigationStarting -= watch; }
    }
}
