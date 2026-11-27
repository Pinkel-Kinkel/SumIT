using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// Sharing summaries with friends through folders that OneDrive keeps in sync:
//  - the student picks which of his courses to share; every finished summary of such a course is written into his own
//    folder in OneDrive (one ZIP per lecture + an index file), and he shares that folder in OneDrive with whom he wants;
//  - a friend adds that folder to his OneDrive from the link, and in each course they both have he is asked whether to
//    use the summaries, and picks which ones.
// A whole course can also travel as one ZIP file (the same folder layout, zipped), also for courses that are not from Moodle.
partial class HitStudent
{
    const string SyncIndexName = "sumit-sync.json";
    string SyncFolder { get { return Str(settings, "syncFolder"); } }   // the single shared folder of older versions
    string MyShareFolder { get { return Str(settings, "shareFolder"); } }

    List<string> SettingList(string key)
    {
        var l = settings.ContainsKey(key) ? settings[key] as ArrayList : null;
        return l == null ? new List<string>() : l.Cast<object>().Select(o => Convert.ToString(o)).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
    }
    void SetSettingList(string key, IEnumerable<string> list) { settings[key] = new ArrayList(list.Distinct(StringComparer.OrdinalIgnoreCase).ToList()); SaveSettings(); }

    List<string> SharedCourses() { return SettingList("shareCourses"); }
    bool IsShared(string course) { return SharedCourses().Any(c => c.Trim() == course.Trim()); }

    // Friends' folders the student added; the old single folder counts as one when someone else published into it.
    List<string> FriendFolders()
    {
        var list = SettingList("friendFolders");
        string old = SyncFolder;
        if (old.Length > 0 && Directory.Exists(old) && !PublishedByMe(ReadSyncIndex(old)) && !list.Contains(old, StringComparer.OrdinalIgnoreCase)) list.Add(old);
        return list;
    }

    // The student's own folder, made in his OneDrive the first time a course is shared.
    string EnsureShareFolder()
    {
        string f = MyShareFolder;
        if (f.Length > 0 && Directory.Exists(f)) return f;
        string old = SyncFolder;
        if (old.Length > 0 && Directory.Exists(old) && PublishedByMe(ReadSyncIndex(old))) f = old;
        else
        {
            string od = InstOneDrive();
            if (od.Length == 0 || !Directory.Exists(od)) { try { od = Directory.GetDirectories(Home, "OneDrive*").FirstOrDefault() ?? ""; } catch { od = ""; } }
            if (od.Length == 0) return null;
            f = Path.Combine(od, "SumIT - הסיכומים שלי");
        }
        Directory.CreateDirectory(f);
        settings["shareFolder"] = f; SaveSettings();
        return f;
    }
    DateTime lastSyncCheck = DateTime.MinValue;
    bool syncBusy;

    Dictionary<string, object> ReadSyncIndex(string folder)
    {
        try
        {
            string file = Path.Combine(folder, SyncIndexName);
            if (File.Exists(file)) return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) ?? new Dictionary<string, object>();
        }
        catch { }
        return new Dictionary<string, object>();
    }

    // This install's own id, so the one who publishes is never offered his own summaries back as a friend's.
    string MySyncId
    {
        get
        {
            if (Str(settings, "syncId").Length == 0) { settings["syncId"] = Guid.NewGuid().ToString("N"); SaveSettings(); }
            return Str(settings, "syncId");
        }
    }

    string MyPublisherName { get { return Str(settings, "displayName").Length > 0 ? Str(settings, "displayName") : Str(settings, "userName"); } }

    bool PublishedByMe(Dictionary<string, object> index)
    {
        string id = Str(index, "publisherId");
        if (id.Length > 0) return id == MySyncId;
        string who = Str(index, "publisher").Trim();   // an index written before the id existed
        return who.Length > 0 && who == MyPublisherName.Trim();
    }

    void WriteSyncIndex(string folder, Dictionary<string, object> index)
    {
        index["format"] = "sumit-sync"; index["version"] = 1;
        index["publisher"] = MyPublisherName;
        index["publisherId"] = MySyncId;
        index["updated"] = DateTime.UtcNow.ToString("o");
        string tmp = Path.Combine(folder, SyncIndexName + ".tmp"), file = Path.Combine(folder, SyncIndexName);
        File.WriteAllText(tmp, json.Serialize(index), Encoding.UTF8);
        if (File.Exists(file)) File.Delete(file);
        File.Move(tmp, file);
    }

    static string LectureStamp(string page, string pdf)
    {
        long ticks = File.GetLastWriteTimeUtc(page).Ticks, len = new FileInfo(page).Length;
        if (!string.IsNullOrEmpty(pdf) && File.Exists(pdf)) { ticks += File.GetLastWriteTimeUtc(pdf).Ticks; len += new FileInfo(pdf).Length; }
        return len + "-" + ticks;
    }

    IEnumerable<int> LectureNumbers(string course)
    {
        string dir = Path.Combine(CourseDir(course), "הרצאות");
        if (!Directory.Exists(dir)) yield break;
        foreach (string d in Directory.GetDirectories(dir, "הרצאה *"))
        {
            int n;
            if (int.TryParse(Path.GetFileName(d).Substring("הרצאה ".Length).Trim(), out n) && n >= 1 && n <= 200) yield return n;
        }
    }

    string LectureTitleOf(string course, int num)
    {
        var meta = LoadMeta(course);
        var rows = meta.ContainsKey("lectures") ? meta["lectures"] as ArrayList : null;
        var row = rows == null ? null : rows.Cast<Dictionary<string, object>>().FirstOrDefault(x => Int(x, "num") == num);
        return row != null && Str(row, "title").Length > 0 ? Str(row, "title") : "הרצאה " + num;
    }

    // Writes the course's finished summaries into "folder" (only the ones that changed) and records them in the index. Returns how many were written.
    int PublishCourseTo(string folder, string course, Dictionary<string, object> index)
    {
        var courses = Dict(index, "courses") ?? new Dictionary<string, object>(); index["courses"] = courses;
        course = course.Trim();
        // An older entry of the same course whose name had extra spaces would be offered again and again.
        foreach (string stale in courses.Keys.Where(k => k != course && k.Trim() == course).ToList()) courses.Remove(stale);
        var entry = Dict(courses, course) ?? new Dictionary<string, object>(); courses[course] = entry;
        entry["lecturer"] = Str(LoadMeta(course), "lecturer");
        var lects = Dict(entry, "lectures") ?? new Dictionary<string, object>(); entry["lectures"] = lects;
        string dirName = SafeName(course), root = CourseDir(course);
        int written = 0;
        foreach (int num in LectureNumbers(course).OrderBy(x => x))
        {
            string page = StudyPagePath(course, num), pdf = LecturePdfPath(course, num);
            if (!File.Exists(page)) continue;
            string stamp = LectureStamp(page, pdf), rel = dirName + "/הרצאה " + num + ".zip";
            string final = Path.Combine(folder, dirName, "הרצאה " + num + ".zip");
            var current = Dict(lects, num.ToString());
            if (current != null && Str(current, "stamp") == stamp && File.Exists(final)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(final));
            string tmp = final + ".tmp";
            if (File.Exists(tmp)) File.Delete(tmp);
            BuildSummaryShare(root, page, File.Exists(pdf) ? pdf : "", tmp);
            if (File.Exists(final)) File.Delete(final);
            File.Move(tmp, final);
            lects[num.ToString()] = new Dictionary<string, object> { { "title", LectureTitleOf(course, num) }, { "file", rel }, { "stamp", stamp } };
            // The one who publishes does not need his own summary offered back to him.
            var meta = LoadMeta(course); var done = Dict(meta, "syncImported") ?? new Dictionary<string, object>();
            done[num.ToString()] = stamp; meta["syncImported"] = done; SaveMeta(course, meta);
            written++;
        }
        return written;
    }

    IEnumerable<string> LocalCourseNames()
    {
        if (StudyRoot.Length == 0 || !Directory.Exists(StudyRoot)) yield break;
        foreach (string d in Directory.GetDirectories(StudyRoot)) { string n = Path.GetFileName(d); if (!n.StartsWith(".")) yield return n; }
    }

    // course == null: every course the student shares.
    async Task PublishToFolder(string course, bool quiet)
    {
        string folder = EnsureShareFolder();
        if (folder == null) { if (!quiet) Toast("לא מצאתי OneDrive במחשב. בחר תיקייה בהגדרות › שיתוף עם חברים", true); return; }
        if (syncBusy) return;
        syncBusy = true;
        try
        {
            int written = await Task.Run(() =>
            {
                var index = ReadSyncIndex(folder);
                int total = 0;
                foreach (string name in course != null ? new[] { course } : SharedCourses().Where(n => Directory.Exists(CourseDir(n))).ToArray()) total += PublishCourseTo(folder, name, index);
                WriteSyncIndex(folder, index);
                return total;
            });
            if (!quiet) Toast(written > 0 ? "שותפו " + written + " סיכומים. OneDrive מעלה אותם, ומי שיש לו גישה לתיקייה יראה אותם בקורס." : "הכל כבר מעודכן בתיקייה המשותפת", false);
        }
        catch (Exception ex) { Toast("הפרסום נכשל: " + ex.Message, true); }
        finally { syncBusy = false; SendSyncState(); }
    }

    // Summaries in a friend's folder for courses this student has, that he has neither taken nor turned down.
    List<Dictionary<string, object>> SyncOffers(string folder)
    {
        var offers = new List<Dictionary<string, object>>();
        var index = ReadSyncIndex(folder);
        var courses = Dict(index, "courses");
        if (courses == null || PublishedByMe(index)) return offers;
        string publisher = Str(index, "publisher");
        var seenNames = new HashSet<string>();
        foreach (var kv in courses)
        {
            string name = kv.Key.Trim();
            if (!seenNames.Add(name) || !Directory.Exists(CourseDir(name))) continue;
            var lects = Dict(kv.Value as Dictionary<string, object>, "lectures"); if (lects == null) continue;
            var meta = LoadMeta(name);
            var done = Dict(meta, "syncImported") ?? new Dictionary<string, object>();
            var declined = Dict(meta, "syncDeclined") ?? new Dictionary<string, object>();
            var list = new List<object>();
            foreach (var l in lects)
            {
                var info = l.Value as Dictionary<string, object>; string stamp = Str(info, "stamp"); int num;
                if (info == null || !int.TryParse(l.Key, out num) || stamp == Str(done, l.Key) || stamp == Str(declined, l.Key)) continue;
                list.Add(new Dictionary<string, object> { { "num", num }, { "title", Str(info, "title") } });
            }
            if (list.Count > 0) offers.Add(new Dictionary<string, object> { { "course", name }, { "count", list.Count }, { "folder", folder }, { "publisher", publisher }, { "lectures", list.OrderBy(o => Int((Dictionary<string, object>)o, "num")).ToList() } });
        }
        return offers;
    }

    void SendSyncState()
    {
        var friends = FriendFolders().Select(f => { bool ok = Directory.Exists(f); return new { path = f, ok = ok, publisher = ok ? Str(ReadSyncIndex(f), "publisher") : "" }; }).ToList();
        var offers = new List<Dictionary<string, object>>();
        foreach (var f in friends) if (f.ok) offers.AddRange(SyncOffers(f.path));
        Send(new { type = "syncState", ok = friends.Any(f => f.ok), offers = offers, shareFolder = MyShareFolder, shareCourses = SharedCourses(), friends = friends });
    }

    // Called from the periodic status poll, but only every few minutes.
    void CheckSyncFolder()
    {
        if (DateTime.Now - lastSyncCheck < TimeSpan.FromMinutes(3)) return;
        lastSyncCheck = DateTime.Now;
        if (SettingList("friendLinks").Count > 0) LookForFriendFolders(false);
        SendSyncState();
    }

    const string ShareFolderPrefix = "SumIT - ";

    // Adds every friend's folder that OneDrive brought to this computer. Once one is found, the pasted links are done.
    int LookForFriendFolders(bool say)
    {
        int added = FindSharedFolders().Count(AddFriendFolder);
        if (added > 0)
        {
            SetSettingList("friendLinks", new List<string>());
            Toast(added == 1 ? "התיקייה של החבר נוספה. בקורסים שיש לשניכם תשאל אם להשתמש בסיכומים." : "נוספו " + added + " תיקיות של חברים", false);
        }
        else if (say) Toast("לא מצאתי עדיין תיקייה חדשה ב-OneDrive. אם לחצת 'הוסף קיצור דרך', חכה דקה שהיא תסתנכרן - האפליקציה תמשיך לחפש לבד.", true);
        return added;
    }

    // The friend's link opens inside the app (already signed in to the college account), the app presses
    // "Add shortcut to My files" by itself, and watches OneDrive until the folder arrives.
    Form friendLinkWindow;
    void OpenFriendLink(string url)
    {
        var links = SettingList("friendLinks");
        if (!links.Contains(url)) { links.Add(url); SetSettingList("friendLinks", links); }
        if (env == null) { OpenExternal(url); Toast("הקישור נפתח בדפדפן. לחץ שם 'הוסף קיצור דרך אל הקבצים שלי' - האפליקציה תמצא את התיקייה לבד.", false); return; }
        if (friendLinkWindow != null && !friendLinkWindow.IsDisposed) friendLinkWindow.Close();
        var win = new Form { Text = "התיקייה של החבר - לחץ 'הוסף קיצור דרך אל הקבצים שלי' (האפליקציה מנסה ללחוץ לבד)", Width = 1100, Height = 760,
            StartPosition = FormStartPosition.CenterParent, RightToLeft = RightToLeft.Yes, RightToLeftLayout = true, Icon = Icon, ShowInTaskbar = false };
        var bar = new Label { Dock = DockStyle.Top, Height = 44, Padding = new Padding(12, 0, 12, 0), TextAlign = System.Drawing.ContentAlignment.MiddleRight,
            Font = new System.Drawing.Font("Segoe UI", 10.5f), BackColor = System.Drawing.Color.FromArgb(37, 99, 235), ForeColor = System.Drawing.Color.White,
            Text = "פותח את התיקייה של החבר... אם צריך, התחבר עם חשבון המכללה." };
        var view = new Microsoft.Web.WebView2.WinForms.WebView2 { Dock = DockStyle.Fill };
        win.Controls.Add(view); win.Controls.Add(bar);
        friendLinkWindow = win;
        var timer = new Timer { Interval = 4000 };
        int ticks = 0; bool clicked = false;
        timer.Tick += async delegate
        {
            ticks++;
            if (LookForFriendFolders(false) > 0) { timer.Stop(); SendSyncState(); try { win.Close(); } catch { } return; }
            if (view.CoreWebView2 == null) return;
            if (!clicked)
            {
                try
                {
                    string r = await view.CoreWebView2.ExecuteScriptAsync(ShortcutScript);
                    if (r.Contains("clicked")) { clicked = true; bar.Text = "לחצתי 'הוסף קיצור דרך'. מחכה ש-OneDrive יביא את התיקייה למחשב (בדרך כלל פחות מדקה)..."; }
                    else if (r.Contains("added")) { clicked = true; bar.Text = "התיקייה כבר נוספה ל-OneDrive שלך. מחכה שהיא תגיע למחשב..."; }
                    else if (ticks > 3) bar.Text = "לחץ בדף על 'הוסף קיצור דרך אל הקבצים שלי' (Add shortcut to My files). אחר כך אפשר לסגור את החלון - האפליקציה תמצא את התיקייה לבד.";
                }
                catch { }
            }
        };
        win.FormClosed += delegate { timer.Stop(); timer.Dispose(); if (friendLinkWindow == win) friendLinkWindow = null; SendSyncState(); };
        win.Shown += async delegate
        {
            try
            {
                await view.EnsureCoreWebView2Async(env);
                view.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; view.CoreWebView2.Navigate(e.Uri); };
                view.CoreWebView2.Navigate(url);
                timer.Start();
            }
            catch (Exception ex) { win.Close(); OpenExternal(url); Toast("לא הצלחתי לפתוח את הקישור באפליקציה, הוא נפתח בדפדפן: " + ex.Message, true); }
        };
        win.Show(this);
    }

    // Finds the "Add shortcut to My files" button of OneDrive / SharePoint (English or Hebrew) and presses it once.
    const string ShortcutScript = @"(function(){
  var want=/add shortcut|הוסף קיצור|הוספת קיצור|קיצור דרך אל/i, done=/shortcut added|added to my files|קיצור הדרך נוסף|נוסף אל/i;
  var els=[].slice.call(document.querySelectorAll('button,[role=button],[role=menuitem],a'));
  for(var i=0;i<els.length;i++){var e=els[i],t=(e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.title||'');
    if(done.test(t))return 'added';
    if(want.test(t)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&e.offsetParent!==null){e.click();return 'clicked';}}
  return 'none';})()";


    // Downloads (unpacks) the new summaries of one course, or of every course, into the course folders.
    async Task ImportFromFolder(string folder, string onlyCourse, bool createMissing, HashSet<int> onlyNums = null)
    {
        try
        {
            var index = ReadSyncIndex(folder);
            string publisher = Str(index, "publisher");
            var courses = Dict(index, "courses");
            if (courses == null) { Toast("לא נמצאו סיכומים בתיקייה", true); return; }
            int got = 0;
            foreach (var kv in courses.ToList())
            {
                string name = kv.Key.Trim();
                if (onlyCourse != null && name != onlyCourse) continue;
                if (!Directory.Exists(CourseDir(name)))
                {
                    if (!createMissing) continue;
                    Directory.CreateDirectory(CourseDir(name));
                    var fresh = LoadMeta(name); fresh["manual"] = true; fresh["setupDone"] = true; SaveMeta(name, fresh);
                }
                var entry = kv.Value as Dictionary<string, object>;
                var lects = Dict(entry, "lectures"); if (lects == null) continue;
                var seen = Dict(LoadMeta(name), "syncImported") ?? new Dictionary<string, object>();
                foreach (var l in lects.OrderBy(x => Int(new Dictionary<string, object> { { "n", x.Key } }, "n")))
                {
                    var info = l.Value as Dictionary<string, object>; int num = Int(new Dictionary<string, object> { { "n", l.Key } }, "n");
                    if (info == null || num < 1 || num > 200 || Str(info, "stamp") == Str(seen, l.Key) || (onlyNums != null && !onlyNums.Contains(num))) continue;
                    string zip = Path.GetFullPath(Path.Combine(folder, Str(info, "file").Replace('/', Path.DirectorySeparatorChar)));
                    if (!IsInside(zip, folder) || !File.Exists(zip)) continue;   // not uploaded yet by OneDrive, or a bad path
                    string dest = Path.Combine(CourseDir(name), SumitDir, "shared", Guid.NewGuid().ToString("N"));
                    string page = await Task.Run(() => UnpackSharedSummary(zip, dest));
                    // The lecture shows up in the course even if the friend never created it himself.
                    var meta = LoadMeta(name); var rows = meta.ContainsKey("lectures") ? meta["lectures"] as ArrayList : null;
                    if (rows == null || !rows.Cast<Dictionary<string, object>>().Any(x => Int(x, "num") == num))
                        SaveLecture(name, new Dictionary<string, object> { { "num", num }, { "title", Str(info, "title") }, { "date", "" }, { "due", "" } });
                    meta = LoadMeta(name);
                    var map = Dict(meta, "sharedSummaries") ?? new Dictionary<string, object>();
                    var list = new List<object>();
                    if (map.ContainsKey(num.ToString()))
                        foreach (object o in (IEnumerable)map[num.ToString()])
                        {
                            var d = json.Deserialize<Dictionary<string, object>>(json.Serialize(o));
                            if (Bool(d, "sync")) { try { string old = Str(d, "path"); string oldRoot = Path.GetDirectoryName(old); if (oldRoot != null && IsInside(oldRoot, Path.Combine(CourseDir(name), SumitDir, "shared"))) Directory.Delete(oldRoot, true); } catch { } }
                            else list.Add(d);
                        }
                    list.Add(new Dictionary<string, object> { { "title", publisher.Length > 0 ? "סיכום של " + publisher : "סיכום מחבר" }, { "path", page }, { "sync", true } });
                    map[num.ToString()] = list; meta["sharedSummaries"] = map;
                    var done = Dict(meta, "syncImported") ?? new Dictionary<string, object>(); done[l.Key] = Str(info, "stamp"); meta["syncImported"] = done;
                    SaveMeta(name, meta);
                    got++;
                    SendSectionLocal(name, num);
                }
                SendCourseLocal(name);
            }
            Toast(got > 0 ? (got == 1 ? "הוספתי סיכום אחד של " : "הוספתי " + got + " סיכומים של ") + (publisher.Length > 0 ? publisher : "חבר") + ". הם מופיעים בהרצאות, ליד הסיכומים שלך." : "אין סיכומים חדשים להוספה", false);
            var after = LoadCoursesQuietly(); // the course list shows the new lectures
        }
        catch (Exception ex) { Toast("ההורדה מהתיקייה המשותפת נכשלה: " + ex.Message, true); }
        finally { SendSyncState(); }
    }

    object LoadCoursesQuietly() { lastCourses = null; LoadCourses(true); return null; }

    // ---------- Whole course as one ZIP ----------

    async void ExportCourseZip(string course)
    {
        try
        {
            if (!Directory.Exists(CourseDir(course))) return;
            string dest;
            using (var save = new SaveFileDialog { Title = "שמירת הקורס לשליחה", Filter = "קורס SumIT|*.zip", FileName = SafeName(course) + " - סיכומים.zip", AddExtension = true, DefaultExt = "zip", OverwritePrompt = true })
            {
                if (save.ShowDialog(this) != DialogResult.OK) return;
                dest = save.FileName;
            }
            Toast("מכין את הקורס לשליחה...", false);
            string tmp = Path.Combine(Path.GetTempPath(), "sumit-course-" + Guid.NewGuid().ToString("N"));
            try
            {
                int n = await Task.Run(() =>
                {
                    Directory.CreateDirectory(tmp);
                    var index = new Dictionary<string, object>();
                    int w = PublishCourseTo(tmp, course, index);
                    WriteSyncIndex(tmp, index);
                    if (File.Exists(dest)) File.Delete(dest);
                    ZipFile.CreateFromDirectory(tmp, dest, CompressionLevel.Fastest, false, Encoding.UTF8);
                    return w;
                });
                Toast(n > 0 ? "הקורס נשמר (" + n + " סיכומים). אפשר לשלוח את הקובץ ב-WhatsApp או OneDrive, והחבר מוסיף אותו ב'הוסף קורס'." : "אין עדיין סיכומים מוכנים בקורס הזה, ולכן אין מה לשלוח", n == 0);
            }
            finally { try { Directory.Delete(tmp, true); } catch { } }
        }
        catch (Exception ex) { Toast("שמירת הקורס נכשלה: " + ex.Message, true); }
    }

    async void ImportCourseZip(string file)
    {
        try
        {
            if (string.IsNullOrEmpty(file))
                using (var dlg = new OpenFileDialog { Title = "בחר קובץ קורס של חבר", Filter = "קורס SumIT|*.zip" })
                {
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    file = dlg.FileName;
                }
            string tmp = Path.Combine(Path.GetTempPath(), "sumit-import-" + Guid.NewGuid().ToString("N"));
            try
            {
                await Task.Run(() => SafeExtractCourseZip(file, tmp));
                if (!File.Exists(Path.Combine(tmp, SyncIndexName))) throw new IOException("זה לא קובץ קורס של SumIT");
                await ImportFromFolder(tmp, null, true);
            }
            finally { try { Directory.Delete(tmp, true); } catch { } }
        }
        catch (Exception ex) { Toast("הוספת הקורס מהקובץ נכשלה: " + ex.Message, true); }
    }

    static void SafeExtractCourseZip(string archive, string destination)
    {
        Directory.CreateDirectory(destination);
        long total = 0; var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var zip = ZipFile.OpenRead(archive))
        {
            if (zip.Entries.Count > 4000) throw new IOException("יותר מדי קבצים בחבילה");
            foreach (var entry in zip.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                if (name.StartsWith("/") || name.Contains(":") || name.Split('/').Any(p => p == ".." || p.EndsWith(".") || p.EndsWith(" "))) throw new IOException("נתיב לא תקין בחבילה");
                string target = Path.GetFullPath(Path.Combine(destination, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!IsInside(target, destination) || !names.Add(target)) throw new IOException("נתיב כפול או מחוץ לחבילה");
                if (name.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                string ext = Path.GetExtension(target).ToLowerInvariant();
                if (ext != ".zip" && ext != ".json") throw new IOException("סוג קובץ לא נתמך בחבילת הקורס");
                total += entry.Length; if (total > 2000L * 1024 * 1024) throw new IOException("חבילת הקורס גדולה מדי");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var input = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew)) input.CopyTo(output);
            }
        }
    }

    // ---------- The folder itself ----------

    // The shared folder, once it was added to the friend's OneDrive ("Add shortcut to My files"): found by its index file.
    List<string> FindSharedFolders()
    {
        var roots = new List<string>(); var found = new List<string>();
        string od = InstOneDrive(); if (od.Length > 0) roots.Add(od);
        try { roots.AddRange(Directory.GetDirectories(Home, "OneDrive*")); } catch { }
        foreach (string root in roots.Distinct(StringComparer.OrdinalIgnoreCase)) SearchMarkers(root, 0, found);
        return found.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    static void SearchMarkers(string dir, int depth, List<string> found)
    {
        try
        {
            if (File.Exists(Path.Combine(dir, SyncIndexName)) || (depth > 0 && Path.GetFileName(dir).StartsWith(ShareFolderPrefix, StringComparison.OrdinalIgnoreCase))) { found.Add(dir); return; }
            if (depth >= 3) return;
            foreach (string d in Directory.GetDirectories(dir))
            {
                string n = Path.GetFileName(d);
                if (n.StartsWith(".") || n.Equals("קורסים", StringComparison.OrdinalIgnoreCase)) continue;
                SearchMarkers(d, depth + 1, found);
            }
        }
        catch { }
    }

    // A folder is a friend's when someone else published into it (and it is not the student's own folder).
    bool AddFriendFolder(string path)
    {
        if (string.IsNullOrEmpty(path) || !Directory.Exists(path) || string.Equals(path, MyShareFolder, StringComparison.OrdinalIgnoreCase) || PublishedByMe(ReadSyncIndex(path))) return false;
        var list = SettingList("friendFolders");
        if (list.Contains(path, StringComparer.OrdinalIgnoreCase)) return false;
        list.Add(path); SetSettingList("friendFolders", list);
        return true;
    }

    void SyncMessage(string type, Dictionary<string, object> m)
    {
        switch (type)
        {
            case "syncState": SendSyncState(); break;
            case "pickSyncFolder":   // a friend's folder, picked by hand
                using (var dlg = new FolderBrowserDialog { Description = "בחר את התיקייה של החבר (בתוך OneDrive)" })
                {
                    string od = InstOneDrive(); if (Directory.Exists(od)) dlg.SelectedPath = od;
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    if (!File.Exists(Path.Combine(dlg.SelectedPath, SyncIndexName))) { Toast("בתיקייה הזו עוד אין סיכומים של SumIT. אם היא עוד מסתנכרנת, חכה רגע ונסה שוב.", true); break; }
                    Toast(AddFriendFolder(dlg.SelectedPath) ? "התיקייה של החבר נוספה" : "התיקייה הזו כבר ברשימה, או שהיא שלך", false);
                    SendSyncState();
                }
                break;
            case "findSyncFolder":
                {
                    LookForFriendFolders(true);
                    lastSyncCheck = DateTime.MinValue; SendSyncState();
                }
                break;
            case "removeFriendFolder":
                {
                    string p = Str(m, "path");
                    SetSettingList("friendFolders", SettingList("friendFolders").Where(x => !string.Equals(x, p, StringComparison.OrdinalIgnoreCase)));
                    if (string.Equals(SyncFolder, p, StringComparison.OrdinalIgnoreCase)) { settings["syncFolder"] = ""; SaveSettings(); }
                    SendSyncState();
                }
                break;
            case "setCourseShare":
                {
                    string course = Str(m, "course").Trim(); bool on = Bool(m, "on");
                    var list = SharedCourses().Where(c => c.Trim() != course).ToList();
                    if (on) list.Add(course);
                    SetSettingList("shareCourses", list);
                    if (on) { var p = PublishToFolder(course, false); }
                    else UnpublishCourse(course);
                    SendSyncState();
                }
                break;
            case "openShareFolder":
                {
                    string f = EnsureShareFolder();
                    if (f == null) { Toast("לא מצאתי OneDrive במחשב. בחר תיקייה ידנית", true); break; }
                    OpenLocal(f);
                    Toast("בחלון שנפתח: קליק ימני על התיקייה שמעל, 'שיתוף' (OneDrive), והוסף את מי שמותר לו לראות. שלח לו את הקישור.", false);
                }
                break;
            case "pickShareFolder":
                using (var dlg = new FolderBrowserDialog { Description = "בחר תיקייה בתוך OneDrive לסיכומים שאתה משתף" })
                {
                    if (Directory.Exists(MyShareFolder)) dlg.SelectedPath = MyShareFolder;
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    settings["shareFolder"] = dlg.SelectedPath; SaveSettings();
                    if (SharedCourses().Count > 0) { var p = PublishToFolder(null, false); } else SendSyncState();
                }
                break;
            case "syncDecline":
                {
                    string course = Str(m, "course"); string folder = Str(m, "folder");
                    if (!FriendFolders().Contains(folder, StringComparer.OrdinalIgnoreCase)) break;
                    var entry = Dict(Dict(ReadSyncIndex(folder), "courses") ?? new Dictionary<string, object>(), course);
                    var lects = Dict(entry, "lectures"); if (lects == null) break;
                    var meta = LoadMeta(course); var declined = Dict(meta, "syncDeclined") ?? new Dictionary<string, object>();
                    foreach (var l in lects) declined[l.Key] = Str(l.Value as Dictionary<string, object>, "stamp");
                    meta["syncDeclined"] = declined; SaveMeta(course, meta);
                    SendSyncState();
                }
                break;
            case "openSyncLink":
                {
                    string url = Str(m, "url").Trim();
                    if (!IsOneDrivePage(url)) { Toast("זה לא נראה כמו קישור משותף של OneDrive", true); break; }
                    OpenFriendLink(url);
                }
                break;
            case "syncPublish": var p1 = PublishToFolder(Str(m, "course").Length > 0 ? Str(m, "course") : null, false); break;
            case "syncImport":
                {
                    string folder = Str(m, "folder");
                    if (!FriendFolders().Contains(folder, StringComparer.OrdinalIgnoreCase) || !Directory.Exists(folder)) { Toast("התיקייה של החבר לא נמצאה במחשב", true); SendSyncState(); break; }
                    HashSet<int> nums = null;
                    var raw = m.ContainsKey("nums") ? m["nums"] as ArrayList : null;
                    if (raw != null) nums = new HashSet<int>(raw.Cast<object>().Select(o => Convert.ToInt32(o)));
                    var p2 = ImportFromFolder(folder, Str(m, "course").Length > 0 ? Str(m, "course") : null, false, nums);
                }
                break;
            case "exportCourseZip": ExportCourseZip(Str(m, "course")); break;
            case "importCourseZip": ImportCourseZip(null); break;
        }
    }

    // A finished summary of a shared course goes to the student's folder by itself.
    void AutoPublishSummary(string course) { if (IsShared(course)) { var t = PublishToFolder(course, true); } }

    // A course the student stopped sharing leaves his folder.
    void UnpublishCourse(string course)
    {
        string folder = MyShareFolder;
        if (folder.Length == 0 || !Directory.Exists(folder)) return;
        try
        {
            var index = ReadSyncIndex(folder); var courses = Dict(index, "courses");
            if (courses != null) foreach (string k in courses.Keys.Where(k => k.Trim() == course.Trim()).ToList()) courses.Remove(k);
            WriteSyncIndex(folder, index);
            string dir = Path.Combine(folder, SafeName(course));
            if (IsInside(dir, folder) && Directory.Exists(dir)) Directory.Delete(dir, true);
        }
        catch (Exception ex) { Toast("לא הצלחתי להסיר את הקורס מהתיקייה: " + ex.Message, true); }
    }
}
