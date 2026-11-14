using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// One button: the app goes through the course's Moodle page by itself and downloads what the student needs for the
// whole course - every past exam with its solutions, or the syllabus (which it then reads into the course information).
partial class HitStudent
{
    static readonly Regex ExamSectionName = new Regex("(מבחן|מבחנ|בחינ|מועד [אבג]|exam|midterm)", RegexOptions.IgnoreCase);
    static readonly string[] SkippedMods = { "forum", "quiz", "label", "choice", "feedback", "lti", "h5pactivity", "zoom" };
    readonly HashSet<string> moodleDownloading = new HashSet<string>();

    // What belongs: for exams, everything in a section about exams and any item named like an exam; for the syllabus, items named like one.
    internal static List<Dictionary<string, object>> PickMoodleItems(List<Dictionary<string, object>> sections, string what)
    {
        var picked = new List<Dictionary<string, object>>();
        var urls = new HashSet<string>();
        foreach (var s in sections)
        {
            bool wholeSection = what == "exams" && ExamSectionName.IsMatch(Str(s, "title"));
            foreach (Dictionary<string, object> it in (s.ContainsKey("items") ? s["items"] as ArrayList : null) ?? new ArrayList())
            {
                if (SkippedMods.Contains(Str(it, "mod")) || Str(it, "url").Length == 0) continue;
                string name = Str(it, "name");
                bool match = what == "exams" ? (wholeSection || ExamName.IsMatch(name)) : (SyllabusName.IsMatch(name) || (SyllabusName.IsMatch(Str(s, "title")) && Str(s, "title").Length < 40));
                bool container = new[] { "folder", "page", "url" }.Contains(Str(it, "mod")) || Regex.IsMatch(name + " " + Str(it, "url"), @"\.zip(?:$|[?\s])", RegexOptions.IgnoreCase);
                if ((match || container) && urls.Add(Str(it, "url"))) { var candidate = new Dictionary<string, object>(it); candidate["discoveryOnly"] = !match; picked.Add(candidate); }
            }
        }
        return picked;
    }

    // A zip of past exams ("מבחנים משנים קודמות") is opened into the same folder: only documents, flat names, nothing outside the folder.
    // Returns how many files came out (the zip itself is then removed).
    static readonly string[] ZipKeep = { ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".txt", ".html", ".htm", ".xlsx" };
    int UnpackZip(string zipPath, string dest, string filter = null, int depth = 0, string context = "", ArchiveBudget budget = null)
    {
        if (!string.Equals(Path.GetExtension(zipPath), ".zip", StringComparison.OrdinalIgnoreCase) || depth > 3) return 0;
        budget = budget ?? new ArchiveBudget(); int n = 0;
        using (var za = System.IO.Compression.ZipFile.OpenRead(zipPath))
        foreach (var en in za.Entries)
        {
            if (++budget.Entries > 1000 || en.Length > 100L * 1024 * 1024 || (budget.Bytes += en.Length) > 300L * 1024 * 1024) throw new IOException("הארכיון גדול מדי לחילוץ אוטומטי");
            if (string.IsNullOrEmpty(en.Name)) continue;
            string ext = Path.GetExtension(en.Name).ToLowerInvariant();
            string label = context + " " + en.FullName;
            if (ext == ".zip") {
                string nested = Path.Combine(Path.GetTempPath(), "sumit-archive-" + Guid.NewGuid().ToString("N") + ".zip");
                try { using (var inp = en.Open()) using (var output = File.Create(nested)) inp.CopyTo(output); n += UnpackZip(nested, dest, filter, depth + 1, label, budget); }
                finally { if (File.Exists(nested)) File.Delete(nested); }
                continue;
            }
            if (!ZipKeep.Contains(ext) || (filter == "syllabus" && !SyllabusName.IsMatch(label)) || (filter == "exams" && !ExamName.IsMatch(label))) continue;
            // Flatten archive paths: traversal and absolute names never become output paths.
            string path = Path.Combine(dest, SafeName(en.FullName.Replace('\\', '_').Replace('/', '_')));
            Directory.CreateDirectory(dest);
            if (File.Exists(path) && new FileInfo(path).Length == en.Length) { n++; continue; }
            string tmp = path + ".part";
            using (var inp = en.Open()) using (var output = File.Create(tmp)) inp.CopyTo(output);
            File.Copy(tmp, path, true); File.Delete(tmp); n++;
        }
        return n;
    }
    class ArchiveBudget { public int Entries; public long Bytes; }

    // A syllabus is often just "קורס 3.pdf": judge it by what is written inside (grading, goals, topics, office hours...).
    static readonly string[] SyllabusWords = { "סילבוס", "מטרות", "דרישות", "נושאי הקורס", "נושאים", "תוצאות למידה", "ציון", "הרכב", "מבחן", "שיעורי בית", "ספרות", "ביבליוגרפיה", "שעות קבלה", "נקודות זכות", "מרצה", "קדם", "syllabus", "grading", "prerequisite", "office hours" };
    internal static bool LooksLikeSyllabus(string sample)
    {
        if (string.IsNullOrWhiteSpace(sample)) return false;
        string head = sample.Length > 12000 ? sample.Substring(0, 12000) : sample;
        if (SyllabusName.IsMatch(head)) return true;
        return SyllabusWords.Count(w => head.IndexOf(w, StringComparison.OrdinalIgnoreCase) >= 0) >= 4;
    }

    async Task<List<string>> DiscoverMoodleFiles(HttpClient http, string url, string what)
    {
        var found = new HashSet<string>(); var visited = new HashSet<string>();
        var pending = new Queue<Tuple<string, int>>(); pending.Enqueue(Tuple.Create(url, 0));
        while (pending.Count > 0 && visited.Count < 60)
        {
            var next = pending.Dequeue(); if (!IsMoodleUrl(next.Item1) || !visited.Add(next.Item1)) continue;
            string html;
            try { html = await http.GetStringAsync(next.Item1); } catch { continue; }
            foreach (Match link in Regex.Matches(html, @"<a\b[^>]*href\s*=\s*['""]([^'""]+)['""][^>]*>([\s\S]*?)</a>", RegexOptions.IgnoreCase))
            {
                Uri target; if (!Uri.TryCreate(new Uri(next.Item1), System.Net.WebUtility.HtmlDecode(link.Groups[1].Value), out target) || !IsMoodleUrl(target.AbsoluteUri)) continue;
                string label = Uri.UnescapeDataString(target.AbsoluteUri) + " " + HtmlToText(link.Groups[2].Value);
                bool relevant = what == "exams" ? ExamName.IsMatch(label) : SyllabusName.IsMatch(label);
                bool archive = target.AbsolutePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
                bool anyDoc = what == "syllabus" && found.Count < 40 && Regex.IsMatch(target.AbsolutePath, @"\.(pdf|docx?|txt)$", RegexOptions.IgnoreCase);
                if (target.AbsolutePath.Contains("pluginfile.php") && (relevant || archive || anyDoc)) found.Add(target.AbsoluteUri);
                else if ((relevant || (what == "syllabus" && found.Count < 40)) && target.AbsolutePath.Contains("/mod/resource/view.php")) found.Add(target.AbsoluteUri + "&redirect=1");
                else if (next.Item2 < 3 && Regex.IsMatch(target.AbsolutePath, @"/mod/(folder|page|resource|url)/view\.php$") && !visited.Contains(target.AbsoluteUri)) pending.Enqueue(Tuple.Create(target.AbsoluteUri, next.Item2 + 1));
            }
        }
        return found.ToList();
    }

    // what = "exams" | "syllabus"
    async void DownloadFromMoodle(string course, int courseId, string what)
    {
        string key = what + "|" + course;
        if (!moodleDownloading.Add(key)) return;
        Send(new { type = "operationStatus", course = course, operation = what, busy = true });
        string label = what == "exams" ? "המבחנים והפתרונות" : "הסילבוס";
        Action<string, int?> status = (t, pct) => Send(new { type = "courseStatus", course = course, busy = true, text = t, pct = pct });
        int saved = 0, failed = 0;
        try
        {
            status("מחפש את " + label + " ב-Moodle...", 0);
            if (courseId <= 0) courseId = Int(LoadMeta(course), "courseId");
            if (courseId <= 0) { Send(new { type = "courseStatus", course = course, busy = false, text = "לא מצאתי את הקורס ב-Moodle. פתח אותו מהרשימה ונסה שוב", error = true }); return; }
            string v = await WithMoodle(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", courseId.ToString()), 120000));
            var sections = json.Deserialize<List<Dictionary<string, object>>>(v);

            var picked = PickMoodleItems(sections, what);
            foreach (var section in sections)
                foreach (Dictionary<string, object> item in (section.ContainsKey("items") ? section["items"] as ArrayList : null) ?? new ArrayList())
                    if (Str(item, "mod") == "resource" && !picked.Any(p => Str(p, "url") == Str(item, "url"))) {
                        var candidate = new Dictionary<string, object>(item); candidate["discoveryOnly"] = true; picked.Add(candidate);
                    }
            picked = picked.OrderBy(p => Bool(p, "discoveryOnly") ? 1 : 0).Take(what == "syllabus" ? 120 : 80).ToList();
            if (picked.Count == 0 && what == "exams" && !Technion)
            {
                int fromCs24 = 0; try { fromCs24 = await Cs24SyncCourse(course, true); } catch { }
                Send(new { type = "courseStatus", course = course, busy = false, error = fromCs24 == 0,
                    text = fromCs24 > 0 ? "ירדו " + fromCs24 + " קבצים של מבחנים מ-CS24" : "לא מצאתי מבחנים ב-Moodle וגם לא ב-CS24. אפשר להוסיף מהמחשב." });
                SendCourseLocal(course);
                return;
            }
            if (picked.Count == 0)
            {
                Send(new { type = "courseStatus", course = course, busy = false, error = true,
                    text = what == "exams" ? "לא מצאתי ב-Moodle של הקורס מבחנים. אפשר להוסיף מ-CS24 או מהמחשב." : "לא מצאתי ב-Moodle של הקורס סילבוס. אפשר להוסיף אותו מהמחשב." });
                return;
            }

            string dest = Path.Combine(CourseDir(course), what == "exams" ? Exams : CourseInfoFolder);
            Directory.CreateDirectory(dest);
            using (var http = await MoodleHttp())
            {
                for (int i = 0; i < picked.Count; i++)
                {
                    var it = picked[i];
                    string mod = Str(it, "mod"), name = Str(it, "name"), url = Str(it, "url");
                    status("מוריד את " + label + " (" + (i + 1) + " מתוך " + picked.Count + "): " + Trunc(name, 60), (int)(100.0 * i / picked.Count));
                    try
                    {
                        if (!IsMoodleUrl(url)) continue;
                        bool discover = Bool(it, "discoveryOnly");
                        var urls = mod == "resource" ? new List<string> { url + (url.Contains("?") ? "&" : "?") + "redirect=1" }
                            : mod == "file" ? new List<string> { url }
                            : discover ? await DiscoverMoodleFiles(http, url, what) : await PluginFiles(http, url);
                        foreach (string f in urls.Distinct()) {
                            string downloadDir = discover ? Path.Combine(CourseDir(course), SumitDir, "discovery") : dest;
                            string path = await DownloadFile(http, f, downloadDir, true, discover ? 64L * 1024 * 1024 : 0); if (path == null) continue;
                            if (Path.GetExtension(path).Equals(".zip", StringComparison.OrdinalIgnoreCase)) saved += UnpackZip(path, dest, discover ? what : null, 0, name + " " + Path.GetFileName(path));
                            else if (!discover) saved++;
                            else {
                                bool matches = (what == "exams" ? ExamName : SyllabusName).IsMatch(Path.GetFileName(path)) || (mod != "resource" && mod != "file");
                                if (!matches && what == "syllabus") {
                                    string sample = await ExtractTexts(new[] { path });
                                    matches = LooksLikeSyllabus(sample);
                                }
                                if (matches) { File.Copy(path, Path.Combine(dest, Path.GetFileName(path)), true); saved++; }
                            }
                        }

                    }
                    catch (Exception ex) { failed++; Toast(Trunc(name, 40) + ": " + ex.Message, true); }
                }
            }
            // Exams are also collected from CS24 (the same course there), so one click gets everything.
            if (what == "exams" && !Technion) { try { saved += await Cs24SyncCourse(course, true); } catch { } }
            Send(new { type = "courseStatus", course = course, busy = false, text = saved > 0 ? "ירדו " + saved + " קבצים: " + label + (failed > 0 ? " (" + failed + " נכשלו)" : "") : "לא ירד שום קובץ", error = saved == 0 });
            SendCourseLocal(course);
            // The syllabus is read straight away: one click does both.
            if (what == "syllabus" && saved > 0) await AnalyzeCourseAsync(course);
        }
        catch (Exception ex) { Send(new { type = "courseStatus", course = course, busy = false, text = ex.Message, error = true }); }
        finally { moodleDownloading.Remove(key); Send(new { type = "operationStatus", course = course, operation = what, busy = false }); }
    }
}
