using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

// The main thing the student gets for each lecture: one PDF with a full, focused summary of the lecture followed by
// its homework, where every question says which part of the summary it uses and how this lecturer expects it solved.
// The AI builds the summary page with the study method; the app prints it to PDF in its own hidden browser and joins
// it with the homework sheets. Both files are saved inside the lecture's folder ("סיכום הרצאה.html" / ".pdf").
partial class HitStudent
{
    // A short digest of a lecture (topics, formulas, methods) that later lectures and the chat read instead of all its files.
    static string DigestRel(int num) { return SumitDir + "/digests/הרצאה " + num + ".md"; }

    string LecturePdfPath(string course, int num)
    {
        return Path.Combine(LectureDir(course, num), SummaryName, SummaryPdfName);
    }

    readonly HashSet<string> summaryRunning = new HashSet<string>();
    readonly Dictionary<string, object> summaryProgress = new Dictionary<string, object>();
    string pdfFailure = "";   // why the last PDF could not be made (plain Hebrew), for the status line

    async void LecturePdf(string course, int num, string title, bool force = false) { await LecturePdfAsync(course, num, title, true, force); }

    string SummaryNotes(string course, int num) { return Str(Dict(LoadMeta(course), "summaryNotes"), num.ToString()); }
    void StartLectureSummary(Dictionary<string, object> message)
    {
        string course = Str(message, "course"); int num = Int(message, "num");
        if (string.IsNullOrWhiteSpace(course) || num < 1 || num > 200 || summaryQueued.Contains(course + "|" + num)) return;
        if (message.ContainsKey("notes")) {
            string notes = Str(message, "notes").Trim(); if (notes.Length > 4000) { Toast("אפשר להוסיף עד 4,000 תווים של הערות", true); return; }
            var meta = LoadMeta(course); var all = Dict(meta, "summaryNotes") ?? new Dictionary<string, object>();
            all[num.ToString()] = notes; meta["summaryNotes"] = all; SaveMeta(course, meta);
        }
        LecturePdf(course, num, Str(message, "title"), Bool(message, "force"));
    }

    // ---------- Progress: a percentage and a rough time left, from how long this course's earlier summaries took ----------

    double EstimatedSummarySeconds(string course)
    {
        var meta = LoadMeta(course);
        string key = Provider == "gemini" ? "summarySecondsGemini" : "summarySeconds";   // Gemini writes slower than Claude: its own history
        var list = meta.ContainsKey(key) ? meta[key] as ArrayList : null;
        if (list == null || list.Count == 0) return Provider == "gemini" ? 1200 : 420;
        return Math.Max(Provider == "gemini" ? 600 : 120, list.Cast<object>().Reverse().Take(3).Select(Convert.ToDouble).Average());
    }

    void RememberSummarySeconds(string course, double seconds)
    {
        var meta = LoadMeta(course);
        string key = Provider == "gemini" ? "summarySecondsGemini" : "summarySeconds";
        var list = (meta.ContainsKey(key) ? meta[key] as ArrayList : null) ?? new ArrayList();
        list.Add((int)seconds);
        while (list.Count > 5) list.RemoveAt(0);
        meta[key] = list;
        SaveMeta(course, meta);
    }

    async Task ProgressTicker(string course, int num, double estimate, DateTime started, Func<string> phase, Func<bool> printing, Func<bool> finished)
    {
        while (!finished())
        {
            double t = (DateTime.UtcNow - started).TotalSeconds;
            // Climbs quickly at first and slows down, so it never reaches 100% before the work is really done.
            double pct = 93 * (1 - Math.Exp(-t / (estimate / 2.3)));
            if (printing()) pct = Math.Max(pct, 95);
            double left = printing() ? 15 : Math.Max(25, estimate - t);
            string elapsed = t > 240 ? " (" + (int)(t / 60) + " דקות)" : "";   // a long write is shown as long, not as "almost there"
            var snapshot = new { pct = (int)Math.Min(99, pct), eta = t > estimate * 1.7 ? -1 : (int)left, text = phase() + elapsed };
            summaryProgress[course + "|" + num] = snapshot;
            Send(new { type = "sectionProgress", course = course, num = num, pct = snapshot.pct, eta = snapshot.eta, text = snapshot.text });
            await Task.Delay(2000);
        }
    }

    async Task<AiResult> LecturePdfCoreAsync(string course, int num, string title, bool open = false, bool force = false)
    {
        string key = "sum|" + course + "|" + num;
        if (aiRuns.ContainsKey(key)) return null;
        if (num < 1 || num > 200) return null;
        string notes = SummaryNotes(course, num);
        string fingerprint = LectureFingerprint(course, num) + title + (notes.Length > 0 ? "\nnotes:" + notes : "");
        string cache = Path.Combine(CourseDir(course), SumitDir, "fingerprints", num + ".txt");
        Directory.CreateDirectory(Path.GetDirectoryName(cache));
        Directory.CreateDirectory(Path.Combine(CourseDir(course), SumitDir, "digests"));
        Directory.CreateDirectory(Path.GetDirectoryName(StudyPagePath(course, num)));
        HideSumit(course);
        if (!force && File.Exists(cache) && File.ReadAllText(cache) == fingerprint && File.Exists(StudyPagePath(course, num)))
        {
            SectionStatus(course, num, "הסיכום מעודכן - החומר לא השתנה, אז לא הייתה צורך לעבוד שוב", false, false);
            SendSectionLocal(course, num);
            if (open) Send(new { type = "summaryReady", course = course, num = num, page = StudyPagePath(course, num), pdf = File.Exists(LecturePdfPath(course, num)) ? LecturePdfPath(course, num) : null });   // the student opens it inside the app
            return null;
        }
        if (!AiReadyOrSay(t => SectionStatus(course, num, t, false, true))) return null;
        string dir = LectureDir(course, num);
        string transcript = Path.Combine(dir, RecordingFolder);
        bool hasTranscript = Directory.Exists(transcript) && Directory.GetFiles(transcript, "*" + TranscriptSuffix + ".txt").Length > 0;
        if (CountFiles(dir) == 0 && !hasTranscript) { SectionStatus(course, num, "אין עדיין חומר להרצאה הזו - הוסף קבצים קודם", false, true); return null; }

        string folder = LectureFolderName(num);
        bool homework = CountFiles(Path.Combine(dir, Exercises)) > 0;
        bool hasSolutions = Directory.Exists(Path.Combine(dir, Exercises)) && Directory.GetFiles(Path.Combine(dir, Exercises), "*", SearchOption.AllDirectories)
            .Any(f => !f.Contains("\\" + PointersFolder + "\\") && Regex.IsMatch(Path.GetFileName(f), "(פתרון|solution|solut|(^|[\\s_.-])sol([\\s_.\\d-]|$))", RegexOptions.IgnoreCase));
        var earlier = Enumerable.Range(1, num - 1).Where(k => File.Exists(Path.Combine(CourseDir(course), DigestRel(k).Replace('/', '\\')))).ToList();
        var noDigest = Enumerable.Range(1, num - 1).Where(k => !earlier.Contains(k) && CountFiles(LectureDir(course, k)) > 0).ToList();
        string prompt = SkillInstruction() + " בנה את חומר הלימוד של הרצאה " + num + " (נושא: \"" + title + "\"). התוצר יודפס ל-PDF אחד שהסטודנט ילמד ממנו.\n"
            + CourseContext(course) + "\n" + StudyLearningPolicy + CompleteQuestionPolicy
            + "מטרת הדף: הסטודנט פותח את הדף ויורד ישר לשיעורי הבית בלי לקרוא קודם את הסיכום, ובכל שאלה מקבל את כל מה שצריך כדי לפתור אותה נכון ולהבין את החומר. לכן שיעורי הבית הם החלק המרכזי והראשון, והסיכום הוא חומר עזר. אל תוסיף הקדמות כלליות, חזרות או שיחות על תהליך העבודה. כל פסקה קצרה, כל שלב בפתרון בשורה נפרדת; תן רווח בין רעיונות. הסבר למה בוחרים שיטה, לא לא רק את התוצאה.\n"
            + SummaryScopeInstructions(course, num)
            + "החומר מצטבר: השתמש בהרצאות 1 עד " + num + " בלבד ואל תכלול הרצאות מאוחרות."
            + (earlier.Count > 0 ? " לכל הרצאה קודמת יש תקציר קצר: " + string.Join(", ", earlier.Select(k => "\"" + DigestRel(k) + "\"")) + ". קרא אותם קודם (זה חוסך זמן), ופתח קובץ מקור של הרצאה קודמת רק כשחסר פרט לשאלה." : "")
            + (noDigest.Count > 0 ? " להרצאות " + string.Join(", ", noDigest) + " אין עדיין תקציר - הצץ בחומר שלהן רק לפי הצורך." : "")
            + " בסוף כתוב גם תקציר \"" + DigestRel(num) + "\" (עד 60 שורות: הנושאים, כל נוסחה ב-LaTeX, הגדרות, שיטות פתרון ושמות הסעיפים בדף) לשימוש ההרצאות הבאות.\n"
            + "החומר של ההרצאה: התיקייה \"" + folder + "\"" + (hasTranscript ? ", התמלול \"" + folder + "/" + RecordingFolder + "\"" : "")
            + ", מצגות ומחברת המרצה ב-\"" + folder + "/" + LecturerNotes + "\", והמחברת של הסטודנט ב-\"" + folder + "/" + Notebook + "\" אם יש.\n"
            + "כתוב את דף הלימוד \"" + folder + "/" + SummaryName + "/" + SummaryHtmlName + "\" לפי הסקיל (אל תיצור קבצים אחרים בתיקיית הסיכום), ובו:\n"
            + (homework
                ? "א. שיעורי הבית (h2 id=\"use\") - החלק הראשון והחשוב ביותר, ובו הסטודנט מתחיל. בנה כל שאלה כך שיהיה אפשר לפתור אותה נכון בלי לקרוא את הסיכום: כל שאלה (וכל סעיף א, ב, ... ב-details משלו) מכילה לפי הסדר: (1) \"השאלה המלאה\" - הנוסח המלא והמדויק כולל נתונים ושרטוטים; (2) \"מה צריך לדעת בשביל זה\" - רק 2 עד 5 מושגים או נוסחאות שהשאלה הזו דורשת, כל אחד בשורה עד שלוש עם הנוסחה ב-KaTeX ומתי משתמשים בה, וקישור \"להסבר המלא\" לסעיף בסיכום; (3) \"איך ניגשים\" - שני רמזים הדרגתיים, כל אחד ב-details.reveal משלו (רמז 1: הכיוון; רמז 2: הצעד הראשון), בלי לחשוף את התשובה; (4) \"פתרון מלא\" ב-details.reveal: כל שלב בשורה נפרדת עם הסיבה לו, ותשובה סופית מודגשת, ואיך המרצה מצפה שיכתבו; (5) \"טעות נפוצה\" ו\"בדוק את עצמך\" (יחידות, מקרה קצה או בדיקה מהירה), שורה אחת כל אחד. הסדר בדף: שיעורי הבית ראשונים, אחריהם הסקירה, ובסוף הסיכום. השאלות בשיעורי הבית ב(תיקייה \"" + folder + "/" + Exercises + "\"): לכל שאלה - לאיזה חלק בסיכום היא קשורה (כתוב את מספר ושם הסעיף במפורש, לא רק קישור), איך לגשת אליה צעד אחר צעד, פתרון מלא ומוסבר בתוך details נפתח, ואיך המרצה מצפה שיענו עליה (שלבים, סימונים, רמת פירוט) לפי הפתרונות שלו לשיעורי בית ולמבחנים קודמים. אם בהרצאה (בתמלול, במצגות או בהערות המרצה) נאמר לא לעשות שאלה או מטלה מסוימת, או שהיא דורשת חומר שעוד לא נלמד עד הרצאה זו, אל תפתור אותה כאן: בתחילת קטע שיעורי הבית בלבד (לא בסקירה ולא בראש הדף) כתוב תיבה אחת <div class=\"notyet\"> עם מספרי השאלות והסיבה (למשל \"שאלה 3: לא לעשות עדיין, המרצה אמרה שהיא שייכת להרצאה הבאה\"), ובכל סעיף של שאלה כזו תן רק רמז קצר בתוך details עם class=\"q notyet\". אל תכתוב על זה דבר בסקירה. בתקציר של ההרצאה כתוב שורה \"נדחו: שאלה N מקובץ X\" לכל שאלה כזו, ואם בתקצירי הרצאות קודמות יש שורת \"נדחו\" והשאלות האלה מתאימות לחומר של הרצאה זו, כלול אותן כאן עם פתרון מלא וציין שהן משיעורי הבית של הרצאה אחרת. אל תניח בלי ראיה: סמן רק מה שנאמר בפועל או שבאמת חסר לו חומר. סדר את שיעורי הבית לפי שאלות: כל סעיף (א, ב, ...) ב-details משלו שכותרתו מתחילה ב-\"שאלה N\" (למשל \"שאלה 1(א)\"), וכל שלב בפתרון בשורה נפרדת ועם רווח, לא גוש טקסט אחד. אם שאלה בשיעורי הבית מבקשת לשרטט, לצייר גרף, דיאגרמה או מעגל, התשובה בסיכום חייבת לכלול את השרטוט עצמו (SVG בתוך הדף, עם תוויות ברורות) ולא רק תיאור במילים. "
                  + (hasSolutions
                      ? "בתיקיית שיעורי הבית יש גם פתרונות רשמיים של המרצה או המתרגל (קבצים עם \"פתרון\" או Sol בשם): הם מקור האמת. התאם אליהם כל פתרון שאתה כותב, ואם מצאת טעות בפתרון הרשמי - ציין זאת במפורש. "
                      : "לא זוהו קבצי פתרונות לפי השם. אם בתיקיית שיעורי הבית יש בכל זאת קבצים שהם פתרונות של המרצה או המתרגל (גם בלי המילה פתרון בשם), הם מקור האמת והתאם אליהם. אחרת פתור בזהירות, בדוק כל שלב פעמיים, וסמן ליד כל פתרון שהוא לא אומת מול פתרון רשמי. ")
                  + "צור גם את קבצי ה-PDF עם המפנים ב-\"" + folder + "/" + Exercises + "/" + PointersFolder + "\".\n"
                : "א. אין עדיין שיעורי בית להרצאה הזו - במקום החלק \"שימוש בתרגילים\" תן 2-3 שאלות תרגול בסגנון של המרצה (מהמבחנים הקודמים, אם יש).\n")
            + "ב. סקירה קצרה (h2 id=\"must\", עד חצי עמוד): מה חובה לדעת מההרצאה ומה אפשר לדלג עליו, לפי מה ששיעורי הבית והמבחנים בודקים. הסיכום צריך לכלול את כל מה שרלוונטי לסטודנט ולהשמיט מה שלא.\n"
            + "ג. סיכום לעיון (h2 id=\"core\"; חומר עזר שהשאלות בשיעורי הבית מפנות אליו, לא חומר שצריך לקרוא לפני שמתחילים לפתור): רק המושגים, השיטות והידע המקדים הנחוצים לשיעורי הבית, לשאלות המבחן הרלוונטיות ולדרישות מפורשות של המרצה. הסבר אותם היטב עם דוגמה מייצגת, בלי לסכם אוטומטית כל שקף או לשכפל דוגמאות.\n"
            + "כתוב תמציתי: בלי הערות מנהליות, חזרות, הסברים על איך נבנה הסיכום או ציטוטים מיותרים. כל שורה צריכה לעזור ללמוד. את שם המרצה ופרטי הקורס אפשר להזכיר פעם אחת בלבד.\n"
            + "עברית, אנגלית, מספרים ונוסחאות מופיעים יחד בדף: כל נוסחה ב-KaTeX, וטקסט באנגלית בתוך משפט בעברית נשאר קריא ובסדר הנכון.\n"
            + "אם קיים לצד דף הסיכום קובץ עם סיומת .interrupted, זו טיוטה שנעצרה: אפשר להיעזר בחלקים התקינים שלה אך יש להשלים ולבדוק לפני שמירה.\n"
            + "לפני שמירה בדוק עקביות: מספרי השאלות שנדחו בתיבת ההנחיות חייבים להתאים בדיוק לסעיפים שסומנו notyet. אל תסמן שאלה שנדרשה לביצוע כנדחית רק מפני שהוזכרה באותה תיבה. הוסף data-deferred-questions עם רשימת מספרים מופרדת בפסיקים לתיבת דחייה של שאלות שלמות; עבור סעיף בלבד סמן רק את ה-details המתאים.\n"
            + "בגרפים: השאר את הקואורדינטות והמספרים משמאל לימין. הסברים בעברית ותוויות ארוכות יופיעו במקרא HTML מתחת לגרף עם סימוני מספרים בגרף, לא כטקסט צפוף על הצירים. ודא שאין חפיפה, חיתוך או טקסט מחוץ ל-viewBox.\n"
            + "הדף יודפס, אז כל טקסט חשוב צריך להיות כתוב בדף עצמו (לא רק בתוך קישור או אנימציה)." + WorkAlone;

        summaryRunning.Add(course + "|" + num);
        var started = DateTime.UtcNow;
        string phaseText = "מתחיל...";
        bool printing = false, finished = false;
        var ticker = ProgressTicker(course, num, EstimatedSummarySeconds(course), started, () => phaseText, () => printing, () => finished);
        AiResult result = null;
        string pdf = null, warning = "";
        try
        {
            result = await CourseTask(key, course, s => { phaseText = s; SectionStatus(course, num, s, true, false); }, prompt);
            if (!result.Error && File.Exists(StudyPagePath(course, num)))
            {
                var authorMeta = LoadMeta(course);
                var writers = Dict(authorMeta, "summaryWriters") ?? new Dictionary<string, object>();
                writers[num.ToString()] = result.Provider ?? Provider; authorMeta["summaryWriters"] = writers; SaveMeta(course, authorMeta);
                // A second AI (Gemini / ChatGPT) reads the homework solutions like a strict reviewer, if one is connected.
                if (HelperOrder().Count > 0)
                {
                    phaseText = "AI נוסף בודק את הפתרונות...";
                    SectionStatus(course, num, phaseText, true, false);
                    try { string note = await SecondOpinion(course, num, result.Provider); if (note != null) SectionStatus(course, num, note, true, false); } catch (Exception ex) { SectionStatus(course, num, "הביקורת לא הושלמה: " + Trunc(ex.Message, 100), true, false); }
                }
                result = await EnsureCompleteQuestions(key, course, num, result, s => { phaseText = s; SectionStatus(course, num, s, true, false); });
                if (!result.Error) {
                    printing = true; phaseText = "מכין את קובץ ה-PDF...";
                    SectionStatus(course, num, phaseText, true, false);
                    pdf = await BuildLecturePdf(course, num); warning = pdfFailure;
                }
            }
        }
        finally { finished = true; summaryRunning.Remove(course + "|" + num); }
        await ticker;
        summaryProgress.Remove(course + "|" + num);
        HideSumit(course);
        if (!result.Error) RememberSummarySeconds(course, (DateTime.UtcNow - started).TotalSeconds);
        Send(new { type = "sectionProgress", course = course, num = num, pct = 100, eta = 0, text = "" });

        bool pageReady = File.Exists(StudyPagePath(course, num));
        string status = result.Error ? "נכשל: " + Trunc(result.Text, 160)
            : pdf != null && warning.Length == 0 ? "הסיכום של ההרצאה מוכן ✨"
            : pdf != null ? "הסיכום מוכן ✨ (" + warning + ")"
            : pageReady ? "הסיכום מוכן, אבל קובץ ה-PDF לא נוצר (" + warning + "). אפשר לפתוח את הסיכום, ולנסות שוב אחר כך."
            : "הסתיים בלי סיכום - נסה שוב";
        SectionStatus(course, num, status, false, result.Error || !pageReady);
        SendSectionLocal(course, num);
        if (pageReady && !result.Error)
        {
            File.WriteAllText(cache, fingerprint); MarkSummaryFormat(course, num);
            Notify("הסיכום של הרצאה " + num + " מוכן", course);
            if (open) Send(new { type = "summaryReady", course = course, num = num, page = StudyPagePath(course, num), pdf = pdf });   // not opened in a browser: the student opens the interactive version inside the app
        }
        return result;
    }

    // Study page (+ the homework sheets) -> one PDF. Returns its path, or null (and says why in pdfFailure).
    async Task<string> BuildLecturePdf(string course, int num)
    {
        await printGate.WaitAsync();
        try { return await BuildLecturePdfCore(course, num); } finally { printGate.Release(); }
    }
    async Task<string> BuildLecturePdfCore(string course, int num)
    {
        pdfFailure = "";
        string page = StudyPagePath(course, num);
        string outPdf = LecturePdfPath(course, num);
        string work = Path.Combine(Path.GetTempPath(), "SumIT-pdf-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        // A printable copy next to the original (so relative links still work): every card open, no buttons.
        string printable = Path.Combine(Path.GetDirectoryName(page), ".print-" + num + ".html");
        try
        {
            PrepareStudyPage(page);
            string html = File.ReadAllText(page, Encoding.UTF8);
            const string extra = "<style>@media print{details>summary .chev,button,input[type=checkbox],.no-print{display:none!important}"
                + "details,.card,.fx{break-inside:avoid-page} h2{break-after:avoid} body{background:#fff}}</style>"
                + "<script>addEventListener('DOMContentLoaded',function(){document.querySelectorAll('details').forEach(function(d){d.open=true})})</script>";
            int head = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
            html = head >= 0 ? html.Insert(head, extra) : extra + html;
            File.WriteAllText(printable, html, new UTF8Encoding(false));

            string summary = Path.Combine(work, "summary.pdf");
            if (!await PrintHtmlToPdf(printable, summary)) return null;

            // The summary first, then each homework sheet (with pointers when there are, the original otherwise).
            string exercises = Path.Combine(LectureDir(course, num), Exercises);
            string pointers = Path.Combine(exercises, PointersFolder);
            var sheets = Directory.Exists(pointers) ? Directory.GetFiles(pointers, "*.pdf").OrderBy(f => f).ToList() : new List<string>();
            if (sheets.Count == 0 && Directory.Exists(exercises)) sheets = Directory.GetFiles(exercises, "*.pdf").OrderBy(f => f).ToList();
            Directory.CreateDirectory(Path.GetDirectoryName(outPdf));
            if (sheets.Count > 0)
            {
                var parts = new List<string> { "סיכום הרצאה " + num, summary };
                foreach (string s in sheets) { parts.Add("שיעורי בית: " + Path.GetFileNameWithoutExtension(s).Replace(" - מפנים", "")); parts.Add(s); }
                string script = Path.Combine(work, "merge.py");
                File.WriteAllText(script, MergeScript, new UTF8Encoding(false));
                if (await EnsurePython(s => { }))
                {
                    var r = await Exec("py", "-3 -I " + Q(script) + " " + Q(outPdf) + " " + string.Join(" ", parts.Select(Q)), null, 180000,
                        new Dictionary<string, string> { { "PYTHONIOENCODING", "utf-8" }, { "PYTHONUTF8", "1" } });
                    if (r.Item1 == 0 && File.Exists(outPdf)) return outPdf;
                    pdfFailure = "דפי התרגיל לא צורפו לקובץ, והם נמצאים בתיקיית התרגילים";
                }
                else pdfFailure = "דפי התרגיל לא צורפו כי חסר Python במחשב, והם נמצאים בתיקיית התרגילים";
            }
            // No homework sheets (or they could not be joined): the summary on its own is still the lecture's PDF.
            File.Copy(summary, outPdf, true);
            return outPdf;
        }
        catch (Exception ex) { pdfFailure = ex.Message; return null; }
        finally
        {
            try { File.Delete(printable); } catch { }
            try { Directory.Delete(work, true); } catch { }
            if (pdfFailure.Length > 0 && !File.Exists(outPdf))
                try { File.WriteAllText(Path.Combine(CourseDir(course), SumitDir, "pdf-error-" + num + ".txt"), DateTime.Now + "\r\n" + pdfFailure, Encoding.UTF8); } catch { }
        }
    }

    // Prints an HTML file to PDF in the app's own hidden browser (no Edge, no Python, and the same engine as the app).
    async Task<bool> PrintHtmlToPdf(string htmlPath, string pdfPath)
    {
        var core = printView != null ? printView.CoreWebView2 : null;
        if (core == null || env == null) { pdfFailure = "הדפדפן הפנימי של האפליקציה לא זמין"; return false; }
        var loaded = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> onDone = (s, e) => loaded.TrySetResult(e.IsSuccess);
        core.NavigationCompleted += onDone;
        try
        {
            try { core.Profile.PreferredColorScheme = Bool(settings, "pdfDark") ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light; } catch { }   // the PDF is light unless the student chose dark
            core.Navigate(new Uri(htmlPath).AbsoluteUri);
            if (await Task.WhenAny(loaded.Task, Task.Delay(60000)) != loaded.Task || !loaded.Task.Result) { pdfFailure = "דף הסיכום לא נטען"; return false; }
            // Wait for the local math renderer and fonts before printing.
            for (int i = 0; i < 24; i++)
            {
                string ready = await core.ExecuteScriptAsync("(document.readyState==='complete'&&document.fonts&&document.fonts.status==='loaded'&&document.documentElement.dataset.sumitMath==='ready')?'1':'0'");
                if (ready == "\"1\"" && i >= 4) break;
                await Task.Delay(500);
            }
            var ps = env.CreatePrintSettings();
            ps.ShouldPrintBackgrounds = true; ps.ShouldPrintHeaderAndFooter = false;
            ps.PageWidth = 8.27; ps.PageHeight = 11.69;
            ps.MarginTop = ps.MarginBottom = ps.MarginLeft = ps.MarginRight = 0.4;
            bool ok = await core.PrintToPdfAsync(pdfPath, ps);
            if (!ok || !File.Exists(pdfPath)) { pdfFailure = "ההדפסה ל-PDF נכשלה"; return false; }
            return true;
        }
        catch (Exception ex) { pdfFailure = ex.Message; return false; }
        finally { core.NavigationCompleted -= onDone; try { core.Navigate("about:blank"); } catch { } }
    }

    // Joins PDFs into one, with a bookmark per part. Arguments: out.pdf, then pairs of (bookmark title, file).
    const string MergeScript = @"import sys, pymupdf
out, rest = sys.argv[1], sys.argv[2:]
doc, toc = pymupdf.open(), []
for title, path in zip(rest[0::2], rest[1::2]):
    try:
        src = pymupdf.open(path)
    except Exception:
        continue
    toc.append([1, title, doc.page_count + 1])
    doc.insert_pdf(src)
if doc.page_count == 0:
    sys.exit(1)
doc.set_toc(toc)
doc.save(out, garbage=3, deflate=True)
";
}
