using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// Sharing summaries with friends through a shared folder that OneDrive keeps in sync:
//  - the one who writes the summaries "publishes" them into the folder (one ZIP per lecture + an index file);
//  - a friend who has the same course sees "N new summaries" and downloads them into that course, next to his own.
// A whole course can also travel as one ZIP file (the same folder layout, zipped), also for courses that are not from Moodle.
partial class HitStudent
{
    const string SyncIndexName = "sumit-sync.json";
    string SyncFolder { get { return Str(settings, "syncFolder"); } }
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

    void WriteSyncIndex(string folder, Dictionary<string, object> index)
    {
        index["format"] = "sumit-sync"; index["version"] = 1;
        index["publisher"] = Str(settings, "displayName").Length > 0 ? Str(settings, "displayName") : Str(settings, "userName");
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

    // course == null: every course that has a finished summary.
    async Task PublishToFolder(string course, bool quiet)
    {
        string folder = SyncFolder;
        if (folder.Length == 0 || !Directory.Exists(folder)) { if (!quiet) Toast("בחר קודם תיקייה משותפת בהגדרות", true); return; }
        if (syncBusy) return;
        syncBusy = true;
        try
        {
            int written = await Task.Run(() =>
            {
                var index = ReadSyncIndex(folder);
                int total = 0;
                foreach (string name in course != null ? new[] { course } : LocalCourseNames().ToArray()) total += PublishCourseTo(folder, name, index);
                WriteSyncIndex(folder, index);
                return total;
            });
            if (!quiet) Toast(written > 0 ? "פורסמו " + written + " סיכומים בתיקייה המשותפת. OneDrive יעלה אותם, והחברים יקבלו הודעה." : "הכל כבר מעודכן בתיקייה המשותפת", false);
        }
        catch (Exception ex) { Toast("הפרסום נכשל: " + ex.Message, true); }
        finally { syncBusy = false; SendSyncState(); }
    }

    // Summaries in the shared folder for courses this student has, that he has not downloaded yet.
    List<Dictionary<string, object>> SyncOffers(string folder)
    {
        var offers = new List<Dictionary<string, object>>();
        var courses = Dict(ReadSyncIndex(folder), "courses");
        if (courses == null) return offers;
        foreach (var kv in courses)
        {
            string name = kv.Key;
            if (!Directory.Exists(CourseDir(name))) continue;
            var lects = Dict(kv.Value as Dictionary<string, object>, "lectures"); if (lects == null) continue;
            var done = Dict(LoadMeta(name), "syncImported") ?? new Dictionary<string, object>();
            int count = lects.Count(l => Str(l.Value as Dictionary<string, object>, "stamp") != Str(done, l.Key));
            if (count > 0) offers.Add(new Dictionary<string, object> { { "course", name }, { "count", count } });
        }
        return offers;
    }

    void SendSyncState()
    {
        string folder = SyncFolder;
        bool ok = folder.Length > 0 && Directory.Exists(folder);
        var offers = ok ? SyncOffers(folder) : new List<Dictionary<string, object>>();
        Send(new { type = "syncState", folder = folder, ok = ok, offers = offers, publisher = ok ? Str(ReadSyncIndex(folder), "publisher") : "" });
    }

    // Called from the periodic status poll, but only every few minutes.
    void CheckSyncFolder()
    {
        if (DateTime.Now - lastSyncCheck < TimeSpan.FromMinutes(3)) return;
        lastSyncCheck = DateTime.Now;
        if (SyncFolder.Length > 0) SendSyncState();
    }

    // Downloads (unpacks) the new summaries of one course, or of every course, into the course folders.
    async Task ImportFromFolder(string folder, string onlyCourse, bool createMissing)
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
                string name = kv.Key;
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
                    if (info == null || num < 1 || num > 200 || Str(info, "stamp") == Str(seen, l.Key)) continue;
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
            Toast(got > 0 ? "הורדתי " + got + " סיכומים של חברים. הם מופיעים בהרצאה, ליד הסיכום שלך." : "אין סיכומים חדשים להורדה", false);
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
    string FindSharedFolder()
    {
        var roots = new List<string>();
        string od = InstOneDrive(); if (od.Length > 0) roots.Add(od);
        try { roots.AddRange(Directory.GetDirectories(Home, "OneDrive*")); } catch { }
        foreach (string root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            string found = SearchMarker(root, 0);
            if (found != null) return found;
        }
        return null;
    }

    static string SearchMarker(string dir, int depth)
    {
        try
        {
            if (File.Exists(Path.Combine(dir, SyncIndexName))) return dir;
            if (depth >= 3) return null;
            foreach (string d in Directory.GetDirectories(dir))
            {
                string n = Path.GetFileName(d);
                if (n.StartsWith(".") || n.Equals("קורסים", StringComparison.OrdinalIgnoreCase)) continue;
                string hit = SearchMarker(d, depth + 1);
                if (hit != null) return hit;
            }
        }
        catch { }
        return null;
    }

    void SyncMessage(string type, Dictionary<string, object> m)
    {
        switch (type)
        {
            case "syncState": SendSyncState(); break;
            case "pickSyncFolder":
                using (var dlg = new FolderBrowserDialog { Description = "בחר את התיקייה המשותפת (בתוך OneDrive)" })
                {
                    if (Directory.Exists(SyncFolder)) dlg.SelectedPath = SyncFolder;
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    settings["syncFolder"] = dlg.SelectedPath; SaveSettings(); SendSettings(); SendSyncState();
                }
                break;
            case "findSyncFolder":
                {
                    string found = FindSharedFolder();
                    if (found == null) { Toast("לא מצאתי את התיקייה ב-OneDrive. ודא שהוספת אותה ('הוסף קיצור דרך אל הקבצים שלי'), חכה שתסתנכרן, ונסה שוב. אפשר גם לבחור אותה ידנית.", true); break; }
                    settings["syncFolder"] = found; SaveSettings(); SendSettings(); lastSyncCheck = DateTime.MinValue; SendSyncState();
                    Toast("מצאתי את התיקייה המשותפת", false);
                }
                break;
            case "openSyncLink":
                {
                    string url = Str(m, "url").Trim();
                    if (!IsOneDrivePage(url)) { Toast("זה לא נראה כמו קישור משותף של OneDrive", true); break; }
                    OpenExternal(url);
                    Toast("הקישור נפתח בדפדפן. לחץ שם 'הוסף קיצור דרך אל הקבצים שלי', חכה שהתיקייה תופיע ב-OneDrive במחשב, ואז לחץ כאן 'חפש את התיקייה'.", false);
                }
                break;
            case "syncPublish": var p1 = PublishToFolder(Str(m, "course").Length > 0 ? Str(m, "course") : null, false); break;
            case "syncImport":
                if (SyncFolder.Length == 0 || !Directory.Exists(SyncFolder)) { Toast("בחר קודם תיקייה משותפת בהגדרות", true); break; }
                var p2 = ImportFromFolder(SyncFolder, Str(m, "course").Length > 0 ? Str(m, "course") : null, false);
                break;
            case "exportCourseZip": ExportCourseZip(Str(m, "course")); break;
            case "importCourseZip": ImportCourseZip(null); break;
        }
    }

    // After a summary is finished: the shared folder gets it too, if the student chose that.
    void AutoPublishSummary(string course)
    {
        if (!Bool(settings, "autoPublishSync") || SyncFolder.Length == 0 || !Directory.Exists(SyncFolder)) return;
        var t = PublishToFolder(course, true);
    }
}
