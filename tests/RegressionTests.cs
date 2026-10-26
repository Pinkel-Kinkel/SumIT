using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
class RegressionTests
{
    [STAThread] static void Main() { HitStudent.RunOfflineRegressionTests(); }
}
partial class HitStudent
{
    public static void RunOfflineRegressionTests()
    {
        using (var app = new HitStudent(new[] { "--demo" }))
        {
            string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "regression-" + Guid.NewGuid().ToString("N"));
            app.settings["studyRoot"] = root;
            Action<string, bool> check = (label, ok) => { if (!ok) throw new Exception(label); Console.WriteLine("PASS: " + label); };
            check("updates default to consent", !app.Option("autoUpdate"));
            check("automatic downloads off", !app.Option("autoSync") && !app.Option("autoRecordings"));
            string course = "test-course";
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 1 }, { "title", "Lecture 1" }, { "date", "2026-10-25" }, { "due", "" } });
            check("lecture persists", app.ManualLectures(course).Count == 1);
            string dir = app.LectureDir(course, 1);
            check("separate student lecture directory", dir.EndsWith(@"הרצאות\הרצאה 1"));
            check("homework directory", Directory.Exists(Path.Combine(dir, Exercises)));
            check("notebook directory", Directory.Exists(Path.Combine(dir, Notebook)));
            check("lecturer notes directory", Directory.Exists(Path.Combine(dir, LecturerNotes)));
            check("a lecture's files are routed to the right folder",
                HitStudent.LectureSubdir(dir, "", "slides.pdf") == Path.Combine(dir, LecturerNotes)
                && HitStudent.LectureSubdir(dir, "", "Sol_List_1.pdf") == Path.Combine(dir, Exercises)
                && HitStudent.LectureSubdir(dir, "notes", "my.pdf") == Path.Combine(dir, Notebook));
            check("summary lives in its own folder inside the lecture", app.StudyPagePath(course, 1) == Path.Combine(dir, SummaryName, SummaryHtmlName) && app.LecturePdfPath(course, 1) == Path.Combine(dir, SummaryName, SummaryPdfName));
            check("the interactive page and the PDF have different names", SummaryHtmlName != SummaryPdfName);
            check("a lecture's subfolders are valid save destinations", app.SafeDownloadFolder(@"הרצאות\הרצאה 1\תרגילים") == Path.Combine(LectureFolderName(1), Exercises)
                && app.SafeDownloadFolder(@"הרצאות\הרצאה 1\..") == SafeName(@"הרצאות\הרצאה 1\.."));
            check("default courses folder is HIT\\קורסים", HitStudent.DefaultStudyRootForTest().EndsWith(@"HIT\קורסים"));
            check("nested download destination", app.SafeDownloadFolder(@"הרצאות\הרצאה 1") == LectureFolderName(1));
            check("download traversal is flattened", !app.SafeDownloadFolder(@"..\..\outside").Contains("\\"));
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "date", "2026-02-31" } });
            check("invalid dates do not create lecture", app.ManualLectures(course).Count == 1);
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "title", "Lecture 2" } });
            File.WriteAllText(Path.Combine(dir, "source.txt"), "version one");
            string original = app.LectureFingerprint(course, 2);
            check("fingerprint stable", original == app.LectureFingerprint(course, 2));
            File.WriteAllText(Path.Combine(dir, "source.txt"), "version two");
            check("prior lecture edit invalidates later summary", original != app.LectureFingerprint(course, 2));
            string current = app.LectureFingerprint(course, 1);
            File.WriteAllText(Path.Combine(app.LectureDir(course, 2), "later.txt"), "future");
            check("future lecture excluded", current == app.LectureFingerprint(course, 1));
            string examDir = Path.Combine(app.CourseDir(course), Exams); Directory.CreateDirectory(examDir);
            string exam = Path.Combine(examDir, "past-exam.pdf"); File.WriteAllText(exam, "new exam");
            check("new exam invalidates lecture summary", current != app.LectureFingerprint(course, 1));
            current = app.LectureFingerprint(course, 1);
            File.WriteAllText(exam, "corrected exam solution");
            check("changed exam invalidates lecture summary", current != app.LectureFingerprint(course, 1));
            current = app.LectureFingerprint(course, 1);

            Directory.CreateDirectory(Path.Combine(dir, SummaryName)); File.WriteAllText(Path.Combine(dir, SummaryName, SummaryPdfName), "generated"); File.WriteAllText(Path.Combine(dir, SummaryName, SummaryHtmlName), "generated");
            check("the summary files themselves do not change the fingerprint", current == app.LectureFingerprint(course, 1));
            File.WriteAllText(Path.Combine(dir, "unrelated.mp4"), "not a recording");
            var local = app.json.Deserialize<Dictionary<string,object>>(app.json.Serialize(app.LocalInfo(course, 1)));
            check("unrelated MP4 not listed as recording", Int(local, "videos") == 0);
            app.working = true; // Exercise queue construction without using Zoom or network.
            check("automatic recording refused", !app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/test", false));
            check("manual recording accepted", app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/test", true, "My lecture"));
            check("recording stored in current lecture", app.jobs.Last().Dir == Path.Combine(dir, RecordingFolder) && app.jobs.Last().Lecture == 1);
            check("custom file name retained", app.jobs.Last().Name == "My lecture");
            app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/second", true, "My lecture");
            check("recording name collisions preserved", app.jobs.Last().Name == "My lecture (2)");
            // The course page of the lecturer: exams in an "exams" section (with solutions), formula sheets, a syllabus, a forum.
            var sections = app.json.Deserialize<List<Dictionary<string, object>>>("[{\"num\":0,\"title\":\"כללי\",\"items\":[{\"mod\":\"resource\",\"name\":\"סילבוס הקורס\",\"url\":\"u1\"},{\"mod\":\"forum\",\"name\":\"הודעות\",\"url\":\"u2\"}]},"
                + "{\"num\":3,\"title\":\"מבחנים לדוגמה\",\"items\":[{\"mod\":\"resource\",\"name\":\"מבחן 2023 מועד א\",\"url\":\"u3\"},{\"mod\":\"resource\",\"name\":\"פתרון\",\"url\":\"u4\"},{\"mod\":\"folder\",\"name\":\"עוד\",\"url\":\"u5\"}]},"
                + "{\"num\":4,\"title\":\"הרצאה 1\",\"items\":[{\"mod\":\"resource\",\"name\":\"שקפים\",\"url\":\"u6\"},{\"mod\":\"resource\",\"name\":\"מבחן אמצע 2022\",\"url\":\"u7\"}]}]");
            var exams = HitStudent.PickMoodleItems(sections, "exams");
            check("every item of the exams section is taken, with the solutions", exams.Select(i => Str(i, "url")).OrderBy(x => x).SequenceEqual(new[] { "u3", "u4", "u5", "u7" }));
            check("an exam named inside a lecture section is taken too, the slides are not", !exams.Any(i => Str(i, "url") == "u6"));
            var syllabus = HitStudent.PickMoodleItems(sections, "syllabus");
            check("only the syllabus is taken for the course information", syllabus.Count(x => !Bool(x, "discoveryOnly")) == 1 && syllabus.Any(x => Str(x, "url") == "u1"));
            // A zip of past exams inside the intro section ("מבחנים משנים קודמות") is found by its name and opened into the exams folder.
            var intro = app.json.Deserialize<List<Dictionary<string, object>>>("[{\"num\":0,\"title\":\"מבוא\",\"items\":[{\"mod\":\"resource\",\"name\":\"מבחנים משנים קודמות\",\"url\":\"z1\"},{\"mod\":\"resource\",\"name\":\"מצגת\",\"url\":\"z2\"}]}]");
            var introPicked = HitStudent.PickMoodleItems(intro, "exams");
            check("an item named like the plural 'past exams' is taken from any section", introPicked.Count == 1 && Str(introPicked[0], "url") == "z1");
            string zdir = Path.Combine(root, "zip-exams"); Directory.CreateDirectory(zdir);
            string zpath = Path.Combine(zdir, "exams.zip");
            using (var za = System.IO.Compression.ZipFile.Open(zpath, System.IO.Compression.ZipArchiveMode.Create))
            {
                foreach (string en in new[] { "2023/exam a.pdf", "2023/solution a.pdf", "../evil.exe", "run.bat" }) { var ze = za.CreateEntry(en); using (var w = new StreamWriter(ze.Open())) w.Write("x"); }
            }
            int unpacked = app.UnpackZip(zpath, zdir);
            check("zip opened safely and original archive is preserved", unpacked == 2 && File.Exists(Path.Combine(zdir, "2023_exam a.pdf")) && File.Exists(Path.Combine(zdir, "2023_solution a.pdf")) && File.Exists(zpath) && !File.Exists(Path.Combine(zdir, "evil.exe")) && !File.Exists(Path.Combine(zdir, "run.bat")));            RunHelperTests(app, root, check);
            RunBrainTests(app, root, check);
            RunLifecycleTests(app, root, check);
            Console.WriteLine("Offline regression checks complete. Fixtures: " + root);
        }
    }


    static void RunLifecycleTests(HitStudent app, string root, Action<string, bool> check)
    {
        var gate = new System.Threading.Tasks.TaskCompletionSource<bool>(); int operations = 0;
        Run(async () => {
            var a = app.RunCourseOperation("A", "info", async () => {operations++;await gate.Task;});
            var duplicate = app.RunCourseOperation("A", "info", () => {operations++;return gate.Task;});
            var b = app.RunCourseOperation("B", "info", async () => {operations++;await gate.Task;});
            check("course operations are independent and duplicate clicks do not restart work", operations == 2 && app.courseOperations.Count == 2);
            gate.SetResult(true);await System.Threading.Tasks.Task.WhenAll(a,b,duplicate);
            await app.RunCourseOperation("A", "info", () => {throw new Exception("expected failure");});
            check("completed and failed course operations release their busy state", app.courseOperations.Count == 0);
            return true;
        });
        int active = 0, peak = 0, calls = 0;
        app.summaryWorkOverride = async (course, num) => {
            active++; peak = Math.Max(peak, active); calls++;
            await System.Threading.Tasks.Task.Delay(40);
            string page = app.StudyPagePath(course, num); Directory.CreateDirectory(Path.GetDirectoryName(page));
            File.WriteAllText(page, "<html><body>complete</body></html>"); active--;
            return new AiResult { Provider = "claude" };
        };
        Run(async () => { var a = app.LecturePdfAsync("queue-a", 1, "one"); var b = app.LecturePdfAsync("queue-b", 1, "two"); var dup = app.LecturePdfAsync("queue-a", 1, "one"); await System.Threading.Tasks.Task.WhenAll(a,b,dup); return true; });
        check("multiple courses serialize and duplicate clicks do not spend tokens", calls == 2 && peak == 1 && app.summaryQueued.Count == 0);
        string previous = app.StudyPagePath("queue-a", 1);
        app.summaryWorkOverride = (course, num) => { File.WriteAllText(previous, "broken partial output"); return System.Threading.Tasks.Task.FromResult(new AiResult { Error = true }); };
        Run(() => app.LecturePdfAsync("queue-a", 1, "one", false, true));
        check("failed regeneration restores the last complete summary", File.ReadAllText(previous).Contains("complete") && File.ReadAllText(previous + ".interrupted").Contains("broken"));
        app.summaryWorkOverride = (course, num) => { app.shuttingDown = true; File.WriteAllText(previous, "interrupted on close"); return System.Threading.Tasks.Task.FromResult(new AiResult { Error = true }); };
        Run(() => app.LecturePdfAsync("queue-a", 1, "one", false, true)); app.shuttingDown = false;
        check("closing retains a durable pending job and the previous page", File.Exists(app.PendingSummary("queue-a",1)) && File.ReadAllText(previous).Contains("complete"));
        app.summaryWorkOverride = (course, num) => System.Threading.Tasks.Task.FromResult(new AiResult { Error = true, Text = "test only" });
        var notesMessage = new Dictionary<string, object> { { "course", "queue-a" }, { "num", 1 }, { "title", "one" }, { "notes", "רק שאלות 1–2; לפרט את השיטה" } };
        app.StartLectureSummary(notesMessage);
        check("summary notes saved per lecture without leaking to other courses", app.SummaryNotes("queue-a",1).Contains("1–2") && app.SummaryNotes("queue-b",1) == "");
        notesMessage["notes"] = ""; app.StartLectureSummary(notesMessage);
        check("summary notes can be cleared", app.SummaryNotes("queue-a",1) == "");
        app.summaryWorkOverride = null;
        string fixture = Path.Combine(root, "math", "lesson.html"); Directory.CreateDirectory(Path.GetDirectoryName(fixture));
        File.WriteAllText(fixture, "<html><head><script src='https://cdn.example/katex.min.js'></script></head><body dir='rtl'>מהירות $v^2-v_0^2=2a\\Delta x$ וגם \\(x+1\\) <details><summary>פתרון</summary>עברית ואנגלית</details></body></html>");
        app.PrepareStudyPage(fixture); app.PrepareStudyPage(fixture);
        string repaired = File.ReadAllText(fixture);
        check("study page repair is offline, idempotent and preserves interaction", repaired.Contains(".sumit-math/katex.min.js") && !repaired.Contains("cdn.example") && System.Text.RegularExpressions.Regex.Matches(repaired,"sumit-render-start").Count == 1 && repaired.Contains("<details>"));
        string bookPage = Path.Combine(root, "math", "book.html");
        File.WriteAllText(bookPage, "<!doctype html><html dir=\"rtl\"><head><meta charset=\"utf-8\"></head><body><div class=\"wrap\"><header class=\"top\"><h1>נושא</h1></header><nav class=\"toc\"><a href=\"#must\">חובה</a><a href=\"#core\">ליבה</a><a href=\"#use\">תרגילים</a></nav><h2 id=\"must\">🎯 מה חובה</h2><p>מהירות $v=x/t$</p><h2 id=\"core\">הסבר</h2><p>$$a=\\frac{\\Delta v}{\\Delta t}$$</p><h2 id=\"use\">🎯 שימוש בתרגילים</h2><p>שאלה 1</p><footer>f</footer></div></body></html>", new System.Text.UTF8Encoding(false));
        app.PrepareStudyPage(bookPage); app.PrepareStudyPage(bookPage);
        string bookHtml = File.ReadAllText(bookPage);
        check("diagram support is offline and added once", System.Text.RegularExpressions.Regex.Matches(bookHtml, "data-sumit-diagrams").Count == 1 && File.Exists(Path.Combine(Path.GetDirectoryName(bookPage), ".sumit-math", "study-diagrams.js")));
        check("the study page becomes a book, added once", System.Text.RegularExpressions.Regex.Matches(bookHtml, "data-sumit-book").Count == 2 && File.Exists(Path.Combine(Path.GetDirectoryName(bookPage), ".sumit-math", "study-book.js")) && bookHtml.Contains("sumit-render-start"));        string sample = Environment.GetEnvironmentVariable("SUMIT_STUDY_SAMPLE");
        if (!string.IsNullOrEmpty(sample) && File.Exists(sample)) {
            string actual = Path.Combine(root, "actual-study", "lesson.html"); Directory.CreateDirectory(Path.GetDirectoryName(actual));
            File.Copy(sample, actual, true); app.PrepareStudyPage(actual);
            check("existing student page repaired on a copy", File.ReadAllText(actual).Contains("sumit-render-start"));
        }
        string archive = Path.Combine(root,"nested.zip"), target = Path.Combine(root,"nested-out"); Directory.CreateDirectory(target);
        using(var zip = System.IO.Compression.ZipFile.Open(archive,System.IO.Compression.ZipArchiveMode.Create)) {
            using(var inner = new System.IO.Compression.ZipArchive(zip.CreateEntry("bundle.zip").Open(), System.IO.Compression.ZipArchiveMode.Create)) {
                using(var w=new StreamWriter(inner.CreateEntry("מבחנים/2024/פתרונות.pdf").Open())) w.Write("solution");
                using(var w=new StreamWriter(inner.CreateEntry("../unrelated.txt").Open())) w.Write("irrelevant");
            }
        }
        check("generic nested zip discovers solutions by parent folder", app.UnpackZip(archive,target,"exams") == 1 && Directory.GetFiles(target).Length == 1);
        check("archive rescanning is idempotent", app.UnpackZip(archive,target,"exams") == 1 && Directory.GetFiles(target).Length == 1);
    }
    // The form installs a WinForms synchronization context, so awaits would wait for a message loop that is not running here.
    static T Run<T>(Func<System.Threading.Tasks.Task<T>> work) { return System.Threading.Tasks.Task.Run(work).GetAwaiter().GetResult(); }

    // Gemini / ChatGPT helpers against a fake local server: nothing here touches the internet or a real key.
    static void RunHelperTests(HitStudent app, string root, Action<string, bool> check)
    {
        var requests = new List<string>();
        var heads = new List<string>();
        int geminiStatus = 200;
        var listener = new System.Net.HttpListener();
        string baseUrl = "http://127.0.0.1:" + new Random().Next(20000, 40000) + "/";
        listener.Prefixes.Add(baseUrl);
        listener.Start();
        var serve = System.Threading.Tasks.Task.Run(() =>
        {
            while (listener.IsListening)
            {
                System.Net.HttpListenerContext c;
                try { c = listener.GetContext(); } catch { return; }
                string body = new StreamReader(c.Request.InputStream, System.Text.Encoding.UTF8).ReadToEnd();
                lock (requests) { requests.Add(c.Request.Url.AbsolutePath + " " + body); heads.Add((c.Request.Headers["x-goog-api-key"] ?? "") + "|" + (c.Request.Headers["Authorization"] ?? "")); }
                bool gem = c.Request.Url.AbsolutePath.Contains("generateContent");
                int status = gem ? geminiStatus : 200;
                string reply = status != 200 ? "{\"error\":{\"message\":\"quota\"}}"
                    : gem ? "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"תשובה מ-Gemini $x^2$\"}]}}]}"
                    : "{\"choices\":[{\"message\":{\"content\":\"תשובה מ-ChatGPT\"}}]}";
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(reply);
                c.Response.StatusCode = status; c.Response.ContentType = "application/json";
                c.Response.OutputStream.Write(bytes, 0, bytes.Length); c.Response.Close();
            }
        });
        Environment.SetEnvironmentVariable("SUMIT_GEMINI_URL", baseUrl.TrimEnd('/'));
        Environment.SetEnvironmentVariable("SUMIT_OPENAI_URL", baseUrl.TrimEnd('/'));
        try
        {
            app.geminiSignedOverride = false; app.codexSignedIn = false;   // whatever this PC is signed in to, the key tests start from nothing
            check("no helper without a key", app.HelperOrder().Count == 0);
            app.settings["geminiKey"] = Protect(new string('g', 30)); app.settings["openaiKey"] = Protect(new string('o', 30));
            check("auto: Gemini first, then ChatGPT", string.Join(",", app.HelperOrder()) == "gemini,openai");
            app.settings["helperPref"] = "openai";
            check("the student can prefer ChatGPT", string.Join(",", app.HelperOrder()) == "openai,gemini");
            app.settings["helperPref"] = "claude";
            check("Claude only means no helpers", app.HelperOrder().Count == 0);
            app.settings["helperPref"] = "auto";

            var msgs = new List<Tuple<string, string>> { Tuple.Create("user", "מה זה אינטגרל?") };
            var r = Run(() => app.HelperAsk("system text", msgs));
            check("Gemini answers", !r.Error && r.Provider == "gemini" && r.Text.Contains("Gemini"));
            check("the key travels in a header and the system text and question in the body", heads[0].StartsWith(new string('g', 30)) && requests[0].Contains("system text") && requests[0].Contains("systemInstruction") && !requests[0].Contains(new string('g', 30)));
            geminiStatus = 429;
            r = Run(() => app.HelperAsk("system text", msgs));
            check("a limit on Gemini passes the question to ChatGPT", !r.Error && r.Provider == "openai" && r.Text.Contains("ChatGPT") && heads.Last().Contains("Bearer " + new string('o', 30)));
            geminiStatus = 200;

            // Summary chat must use only Gemini even when general chat prefers another provider.
            app.settings["helperPref"] = "claude";
            string fullSummary = FullSummaryContext("<script>DROP-ME</script><p>BEGIN</p>" + new string('x', 70000) + "<details><p>HIDDEN-END $x^2$</p></details><svg><text>DIAGRAM</text></svg>");
            int before = requests.Count;
            r = Run(() => app.SummaryGemini(fullSummary, msgs, new byte[] { 1, 2, 3 }));
            check("summary Gemini ignores general provider order and receives complete context plus selected image", !r.Error && requests.Count == before + 1 && requests.Last().Contains("HIDDEN-END") && requests.Last().Contains("DIAGRAM") && requests.Last().Contains("inline_data") && !requests.Last().Contains("DROP-ME"));
            geminiStatus = 429; before = requests.Count;
            r = Run(() => app.SummaryGemini(fullSummary, msgs, null));
            check("summary quota falls back to connected ChatGPT with complete context", !r.Error && r.Provider == "openai" && requests.Count == before + 2 && requests.Last().Contains("HIDDEN-END"));
            geminiStatus = 200;
            var savedGeminiKey = app.settings["geminiKey"]; app.settings.Remove("geminiKey"); before = requests.Count;
            r = Run(() => app.SummaryGemini(fullSummary, msgs, null));
            check("missing Gemini uses connected ChatGPT", !r.Error && r.Provider=="openai" && requests.Count == before+1);
            check("quota discussion is not a quota error", !IsUsageLimit("Explain quota policies") && IsUsageLimit("RESOURCE_EXHAUSTED HTTP 429"));
            app.settings["geminiKey"] = savedGeminiKey; app.settings["helperPref"] = "auto";

            // A lecture question is answered from the digests and the summary the app already has.
            string course = "helper-course";
            Directory.CreateDirectory(Path.Combine(app.CourseDir(course), SumitDir, "digests"));
            File.WriteAllText(Path.Combine(app.CourseDir(course), SumitDir, "digests", "הרצאה 1.md"), "DIGEST-ONE נוסחת רימן");
            check("nothing to read yet: the question goes to Claude", app.HelperContext("empty-course", "lesson:1") == null && app.HelperContext(course, "course") == null);
            check("a later lecture is built on the earlier digests", app.HelperContext(course, "lesson:3").Contains("DIGEST-ONE"));
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "title", "L2" } });
            Directory.CreateDirectory(Path.GetDirectoryName(app.StudyPagePath(course, 2)));
            File.WriteAllText(app.StudyPagePath(course, 2), "<html><style>.x{}</style><body><h2>SECTION-TWO</h2><script>alert(1)</script><p>טקסט <b>חשוב</b> &amp; נוסחה $a+b$</p></body></html>");
            string ctx = app.HelperContext(course, "lesson:2");
            check("the context holds the earlier digest and the summary text, without markup", ctx != null && ctx.Contains("DIGEST-ONE") && ctx.Contains("SECTION-TWO") && ctx.Contains("חשוב") && ctx.Contains("$a+b$") && !ctx.Contains("<b>") && !ctx.Contains("alert(1)"));
            check("a later lecture is not mixed in", !app.HelperContext(course, "lesson:1").Contains("SECTION-TWO"));
            var said = new List<string>();
            bool answered = Run(() => app.HelperChat(course, "lesson:2", "תסביר לי", (role, t) => said.Add(role + ":" + t)));
            check("the chat is answered by a helper and remembered", answered && said.Count == 1 && said[0].StartsWith("assistant:") && app.LoadMeta(course).ContainsKey("lectureChatHistories"));
            check("the question reached the helper with the lecture's text", requests.Last().Contains("SECTION-TWO") && requests.Last().Contains("תסביר לי"));

            // A page read by a helper updates the timetable, the exams and the holidays.
            app.settings["studyRoot"] = Path.Combine(root, "courses");
            var data = app.json.Deserialize<Dictionary<string, object>>("{\"classes\":[{\"day\":\"ראשון\",\"start\":\"08:30\",\"end\":\"11:00\",\"course\":\"אינפי\"}],\"exams\":[{\"course\":\"אינפי\",\"moed\":\"א\",\"date\":\"2027-02-03\"}],\"semesterStart\":\"2026-10-18\",\"holidays\":[{\"name\":\"חנוכה\",\"from\":\"2026-12-06\",\"to\":\"2026-12-07\"}]}");
            app.ApplySchedule(data);
            var data2 = app.json.Deserialize<Dictionary<string, object>>("{\"classes\":[],\"exams\":[{\"course\":\"פיזיקה\",\"moed\":\"א\",\"date\":\"2027-02-10\"}],\"holidays\":[]}");
            app.ApplySchedule(data2);
            var tt = app.json.Deserialize<Dictionary<string, object>>(File.ReadAllText(app.TimetableJson));
            var ac = app.json.Deserialize<Dictionary<string, object>>(File.ReadAllText(app.AcademicJson));
            check("a second page keeps the classes and adds the exam", ((System.Collections.ArrayList)tt["classes"]).Count == 1 && ((System.Collections.ArrayList)tt["exams"]).Count == 2);
            check("the semester start and holidays are kept", Str(ac, "semesterStart") == "2026-10-18" && ((System.Collections.ArrayList)ac["holidays"]).Count == 1);
            check("JSON is found inside a code fence", JsonFromAnswer("```json\n{\"a\":1}\n```", app.json) != null && JsonFromAnswer("no json here", app.json) == null);
        }
        finally { listener.Stop(); Environment.SetEnvironmentVariable("SUMIT_GEMINI_URL", null); Environment.SetEnvironmentVariable("SUMIT_OPENAI_URL", null); }
    }

    // ChatGPT and Gemini on the student's subscription, with fake command-line tools that behave like the real ones.
    static void RunBrainTests(HitStudent app, string root, Action<string, bool> check)
    {
        string fakes = Path.Combine(root, "fakes");
        Directory.CreateDirectory(fakes);
        File.WriteAllText(Path.Combine(fakes, "fake.ps1"), @"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$argline = $env:FAKE_ARGS
if ($argline -match 'login' -and $argline -match 'status') { 'Logged in using ChatGPT'; exit 0 }
if ($env:FAKE_AGY_LOGIN -eq '1') {
  if ($argline -match 'READY') { if ($env:FAKE_VERIFY_WAIT -eq '1') { Start-Sleep 60 }; Write-Host 'READY'; exit 0 }
  if ($env:FAKE_AGY_WAIT -eq '1') { Start-Sleep 60; exit 0 }
  Start-Sleep 2; Set-Content -Path $env:FAKE_AGY_CRED -Value 'saved'; Start-Sleep 60; exit 0   # the sign-in screen: the account gets saved a moment later
}
if ($env:FAKE_LOGIN -eq '1') {
  if ($env:CI) { [Console]::Error.WriteLine('non-interactive session'); exit 41 }   # like the real Gemini CLI: with CI set it never opens a browser
  Write-Host -NoNewline 'Opening authentication page in your browser. Do you want to continue? [Y/n]: '   # no line break, like the real one
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)   # like node: the input is UTF-8 (the app may put a byte-order mark in front)
  $line = [Console]::In.ReadLine()
  if ($line -and $line.Trim().TrimStart([char]0xFEFF) -eq 'Y') { Set-Content -Path $env:FAKE_LOGIN_FLAG -Value 'signed-in'; Write-Host 'https://accounts.example/login?x=1'; Start-Sleep 1 }
  exit 0
}
if ($env:FAKE_NAME -eq 'gemini') { $text = Get-Content -Raw -Encoding UTF8 -Path (Join-Path (Get-Location) 'material.txt') } else { $text = [Console]::In.ReadToEnd() }
if ($env:FAKE_IMAGE -eq '1') { Write-Output ('image=' + (Test-Path -LiteralPath 'selection.png') + '; instructed=' + ($text -match 'selection.png')); exit 0 }
if ($env:FAKE_FAIL -eq '1') { [Console]::Error.WriteLine('usage limit reached'); exit 1 }
if ($env:FAKE_REPLY) { $ans = $env:FAKE_REPLY } else { $ans = $env:FAKE_NAME + ' saw ' + $text.Length + ' chars; marker=' + ($text -match 'MARKER-Q') }
$m = [regex]::Match($argline, '\s-o\s+(\S+)')
if ($env:FAKE_NAME -eq 'codex' -and $m.Success) {
  $outFile = $m.Groups[1].Value.Trim('""')
  [System.IO.File]::WriteAllText($outFile, [string]$ans, (New-Object System.Text.UTF8Encoding($false)))
} else { $ans }
");
        foreach (string name in new[] { "codex", "gemini" })
            File.WriteAllText(Path.Combine(fakes, "fake-" + name + ".cmd"), "@echo off\r\nset FAKE_NAME=" + name + "\r\nset FAKE_ARGS=%*\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake.ps1\"\r\n");
        Environment.SetEnvironmentVariable("SUMIT_CODEX", Path.Combine(fakes, "fake-codex.cmd"));
        Environment.SetEnvironmentVariable("SUMIT_AGY", Path.Combine(fakes, "fake-gemini.cmd"));
        try
        {
            // Nothing connected by key; both signed in by account.
            app.settings.Remove("geminiKey"); app.settings.Remove("openaiKey"); app.settings["helperPref"] = "auto";
            app.codexSignedIn = false; app.geminiSignedOverride = false;
            check("not signed in: no helper", app.HelperOrder().Count == 0);
            app.codexSignedIn = true; app.geminiSignedOverride = true;
            check("signed in with the accounts: both helpers, Gemini first", string.Join(",", app.HelperOrder()) == "gemini,openai" && app.HelperMode("gemini") == "account" && app.HelperMode("openai") == "account");

            var msgs = new List<Tuple<string, string>> { Tuple.Create("user", "MARKER-Q " + new string('x', 120000)) };
            var r = Run(() => app.HelperAsk("system", msgs));
            check("Gemini answers through the account, a long text goes in on stdin", !r.Error && r.Provider == "gemini" && r.Text.Contains("gemini saw") && r.Text.Contains("marker=True") && !r.Text.Contains("saw 0 "));
            Environment.SetEnvironmentVariable("FAKE_IMAGE", "1");
            r = Run(() => app.SummaryGemini("system", msgs, new byte[] { 1, 2, 3 }));
            check("Gemini account gets selected image file and reading instructions", !r.Error && r.Provider == "gemini" && r.Text.Contains("image=True") && r.Text.Contains("instructed=True"));
            Environment.SetEnvironmentVariable("FAKE_IMAGE", null);
            r = Run(() => app.HelperAsk("system", msgs, "openai"));
            check("ChatGPT answers through the account", !r.Error && r.Provider == "openai" && r.Text.Contains("codex saw") && r.Text.Contains("marker=True"));

            Environment.SetEnvironmentVariable("FAKE_FAIL", "1");
            r = Run(() => app.HelperAsk("system", msgs));
            check("a limit on the subscription is reported as a limit", r.Error && r.Limit);
            Environment.SetEnvironmentVariable("FAKE_FAIL", null);

            // The sign-in: the tool asks "[Y/n]", the app answers, the browser would open, the account is signed in.
            string flag = Path.Combine(fakes, "signed.txt");
            Environment.SetEnvironmentVariable("FAKE_LOGIN", "1"); Environment.SetEnvironmentVariable("FAKE_LOGIN_FLAG", flag);
            Run(async () => { await app.RunLogin(Path.Combine(fakes, "fake-gemini.cmd"), "-p hello", "gemini", () => File.Exists(flag), true); return 0; });
            check("the sign-in is answered by the app", File.Exists(flag));
            Environment.SetEnvironmentVariable("FAKE_LOGIN", null);

            // Gemini's sign-in (Antigravity): its sign-in screen runs, the account gets saved, and a tiny question proves it works.
            string credFlag = Path.Combine(fakes, "agy-credential.txt");
            Environment.SetEnvironmentVariable("FAKE_AGY_LOGIN", "1"); Environment.SetEnvironmentVariable("FAKE_AGY_CRED", credFlag); Environment.SetEnvironmentVariable("SUMIT_AGY_CRED", credFlag);
            app.settings["agyOk"] = false; app.geminiSignedOverride = null;
            bool signedIn = Run(() => app.LoginAgy());
            check("Gemini sign-in: once the account is saved the app is connected", signedIn && Bool(app.settings, "agyOk") && app.HelperMode("gemini") == "account");
            File.Delete(credFlag);
            Environment.SetEnvironmentVariable("FAKE_AGY_WAIT", "1");
            app.AgyLoginTimeoutSeconds = 1;
            var loginWatch = System.Diagnostics.Stopwatch.StartNew();
            signedIn = Run(() => app.LoginAgy());
            check("Gemini sign-in times out without claiming connected", !signedIn && !Bool(app.settings, "agyOk") && loginWatch.Elapsed.TotalSeconds < 10);
            app.AgyLoginTimeoutSeconds = 300;
            loginWatch.Restart();
            signedIn = Run(async () => { var pending = app.LoginAgy(); await System.Threading.Tasks.Task.Delay(200); app.CancelAgyLogin(); return await pending; });
            check("Gemini sign-in can be cancelled promptly", !signedIn && app.agyLoginProcess == null && loginWatch.Elapsed.TotalSeconds < 10);
            Environment.SetEnvironmentVariable("FAKE_AGY_WAIT", null);
            Environment.SetEnvironmentVariable("FAKE_VERIFY_WAIT", "1");
            signedIn = Run(async () => {
                var pending = app.LoginAgy();
                for (int attempt = 0; attempt < 100; attempt++) {
                    if (app.agyLoginProcess != null && app.agyLoginProcess.StartInfo.Arguments.Contains("READY")) break;
                    await System.Threading.Tasks.Task.Delay(100);
                }
                app.CancelAgyLogin(); return await pending;
            });
            check("Gemini verification is cancellable too", !signedIn && app.agyLoginProcess == null);
            Environment.SetEnvironmentVariable("FAKE_VERIFY_WAIT", null);
            File.Delete(credFlag);
            Environment.SetEnvironmentVariable("FAKE_AGY_LOGIN", null);
            app.codexSignedIn = true; app.geminiSignedOverride = true;

            bool wasLogged = app.claudeLoggedIn; app.claudeLoggedIn = true;
            var routed = new List<string>();
            app.aiWorkOverride = provider => { routed.Add(provider); return System.Threading.Tasks.Task.FromResult(new AiResult { Error = provider != "gemini", Text = provider != "gemini" ? "usage limit reached" : "ready" }); };
            var routedResult = Run(() => app.RunAi("routing", root, "test", null, null, null));
            check("generation falls back Claude then ChatGPT then Gemini", string.Join(",", routed) == "claude,openai,gemini" && routedResult.Provider == "gemini" && !routedResult.Error);
            routed.Clear(); app.aiWorkOverride = provider => { routed.Add(provider); return System.Threading.Tasks.Task.FromResult(new AiResult { Error = true, Text = "invalid input" }); };
            Run(() => app.RunAi("routing", root, "test", null, null, null));
            check("non-quota errors do not spend another provider", routed.Count == 1);
            app.aiWorkOverride = null; app.claudeLoggedIn = wasLogged;
            // A second opinion on a lecture summary: the notes are added to the page, and a repeat replaces them.
            string course = "review-course";
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 1 }, { "title", "L1" } });
            Directory.CreateDirectory(Path.GetDirectoryName(app.StudyPagePath(course, 1)));
            File.WriteAllText(app.StudyPagePath(course, 1), "<html><body><h1>סיכום</h1><p>שאלה 2: התשובה היא 5</p></body></html>");
            Environment.SetEnvironmentVariable("FAKE_REPLY", "{\"verdict\":\"issues\",\"issues\":[{\"where\":\"שאלה 2\",\"problem\":\"החישוב שגוי\",\"old\":\"התשובה היא 5\",\"new\":\"התשובה היא 7\"},{\"where\":\"שאלה 9\",\"problem\":\"לא ניתן לצטט\",\"old\":\"\",\"new\":\"\"}]}");
            string note = Run(() => app.SecondOpinion(course, 1, "claude"));
            string html = File.ReadAllText(app.StudyPagePath(course, 1));
            check("a reviewer's correction is made in the page itself, quietly", note != null && note.Contains("תיקן") && html.Contains("התשובה היא 7") && !html.Contains("התשובה היא 5") && html.Contains("<h1>סיכום</h1>") && !html.Contains("בדיקה שנייה"));
            check("what could not be quoted stays as a small closed note", html.Contains("הערות לבדיקה") && !html.Contains("<section id=\"second-opinion"));
            Environment.SetEnvironmentVariable("FAKE_REPLY", "{\"verdict\":\"ok\",\"issues\":[]}");
            File.WriteAllText(app.StudyPagePath(course, 1), html.Replace("התשובה היא 7", "התשובה היא 7 (בדיקה)"));
            note = Run(() => app.SecondOpinion(course, 1, "claude"));
            html = File.ReadAllText(app.StudyPagePath(course, 1));
            check("a clean check says so and clears the old note", note.Contains("לא מצא טעויות") && !html.Contains("הערות לבדיקה"));
            Environment.SetEnvironmentVariable("FAKE_REPLY", "{\"verdict\":\"issues\",\"issues\":[{\"where\":\"x\",\"problem\":\"y\",\"old\":\"\",\"new\":\"\"}]}");
            note = Run(() => app.SecondOpinion(course, 1, "claude"));
            check("unchanged review reuses cached result", note.Contains("לא מצא טעויות"));            Environment.SetEnvironmentVariable("FAKE_REPLY", null);
            app.codexSignedIn = false; app.geminiSignedOverride = false;
            check("with no other AI the check is skipped", Run(() => app.SecondOpinion(course, 1)) == null);

            // The real thing, when asked for: a tiny question through the ChatGPT subscription that is signed in on this PC.
            string realCodex = Environment.GetEnvironmentVariable("SUMIT_REAL_CODEX");
            if (!string.IsNullOrEmpty(realCodex) && File.Exists(realCodex))
            {
                Environment.SetEnvironmentVariable("SUMIT_CODEX", realCodex);
                Run(() => { var t = app.RefreshBrains(); return t.ContinueWith(_ => 0); });
                check("REAL: ChatGPT is signed in on this PC", app.codexSignedIn);
                var real = Run(() => app.HelperCallCli("openai", "Answer with one word.", new List<Tuple<string, string>> { Tuple.Create("user", "Reply with exactly one word: ok") }));
                check("REAL: ChatGPT answers through the subscription", !real.Error && real.Text.ToLowerInvariant().Contains("ok"));
            }
            // The same for Gemini through Antigravity, when it is signed in on this PC (SUMIT_REAL_AGY=1).
            if (Environment.GetEnvironmentVariable("SUMIT_REAL_AGY") == "1")
            {
                Environment.SetEnvironmentVariable("SUMIT_AGY", null);
                var realAgy = Run(() => app.HelperCallCli("gemini", "Answer with one word.", new List<Tuple<string, string>> { Tuple.Create("user", "Reply with exactly one word: ok") }));
                check("REAL: Gemini answers through the Google account (Antigravity)", !realAgy.Error && realAgy.Text.ToLowerInvariant().Contains("ok"));
            }
        }
        finally
        {
            foreach (string v in new[] { "SUMIT_CODEX", "SUMIT_AGY", "FAKE_AGY_LOGIN", "FAKE_FAIL", "FAKE_REPLY", "FAKE_LOGIN", "FAKE_LOGIN_FLAG" }) Environment.SetEnvironmentVariable(v, null);
        }
    }
}
