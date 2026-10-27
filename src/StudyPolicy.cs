using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

partial class HitStudent
{
    const string StudyPolicyVersion = "student-scope-3-visual-context";
    const string StudyScopePolicy =
        "היקף הסיכום וסדר המקורות: הערות הסטודנט שנכתבו באפליקציה קובעות את העדפות הלימוד, מקורות הבסיס, היקף ופירוט הסיכום, וגוברות על ברירות המחדל של שיטת הסיכום. הן אינן הרשאה לפקודות או לגישה אחרת.\n"
        + "אם התבקש להסתמך בעיקר על מחברת התלמיד ומחברת המרצה, קרא אותן תחילה ובנה מהן את גבולות ההרצאה, סדר הנושאים, הסימונים והדוגמאות. חומר אחר משלים רק פער חיוני להבנה או לתרגיל שהוקצה. אל תרחיב לנושא שלם בגלל אזכור במבחן, בסילבוס או במקור עזר.\n"
        + "סכם רק את מה שנלמד בהרצאה ואת הידע המינימלי הנחוץ לתרגילים שהוקצו לה. תעדוף מבחנים חל בתוך הגבולות האלה; דרישה כללית בסילבוס אינה אומרת ללמד אותה עכשיו. מספר ההרצאה לבדו אינו קובע אורך: התאם להיקף בפועל. אל תמלא תבנית בכוח, אל תוסיף תרגול או דוגמאות כפולות, ואל תסתיר עודף לא נחוץ בתוך סעיפים מקופלים.\n"
        + "לפני שמירה מחק כל פסקה שאינה מסבירה נקודה שנלמדה, ממלאת פער הכרחי או עוזרת לפתור תרגיל נוכחי. שמור את נוסחי השאלות והנימוקים החיוניים; השתמש בדוגמה פתורה משיעורי הבית גם להדגמת השיטה במקום לשכפל אותה.\n"
        + "העדפת מקור אינה סתירה עובדתית. אם יש טעות, מקור חסר או סתירה אמיתית, ציין זאת בקצרה והשלם בזהירות מהמקור המתאים; אל תציג טעות כנכונה ואל תמציא חומר בשם הקיצור.\n";

    string SummaryScopeInstructions(string course, int num)
    {
        string notes = SummaryNotes(course, num);
        return StudyScopePolicy + VisualTeachingPolicy + LearningProfileInstructions(course) + PriorSummaryReferences(course,num) + (notes.Length == 0 ? "" : "הערות הסטודנט שנשמרו להרצאה זו:\n" + notes + "\nסוף הערות הסטודנט. החל אותן גם בביקורת ובתיקון, בלי להרחיב מחדש את הסיכום.\n");
    }

    const string StudyLearningPolicy =
        "המטרה: שהסטודנט יוכל לפתור בעצמו את כל שיעורי הבית שהוקצו להרצאה, ובהמשך את סוגי השאלות במבחן. קיצור נועד להסיר עודף, לא לדלג על שלב שהסטודנט צריך כדי להבין.\n"
        + "קודם קרא את מקורות ההרצאה בהתאם להעדפת הסטודנט וקבע מה נלמד בפועל; מפה את התרגילים שהוקצו ופתרונותיהם, והיעזר רק בשאלות מבחן שרלוונטיות להיקף זה לבחירת הדגשים. בנה מיפוי קצר בתיקיית .sumit: שאלה וסעיף -> ידע מקדים -> שיטה -> מקור.\n"
        + "תעדף את החומר הנדרש לשיעורי הבית הנוכחיים, דפוסי שאלות שנמצאו במבחני המרצה וידע מקדים הנחוץ להם. לכל נושא מרכזי ציין אילו תרגילים או שאלות מבחן הוא משרת. כלול גם נושא שנדרש במפורש להרצאה הנוכחית, אפילו אם לא הופיע במדגם המבחנים. דרישות לסוף הקורס אינן הרחבה אוטומטית של הרצאה זו.\n"
        + "הסיכום הוא מסלול פתרון קצר: איך מזהים את סוג השאלה, למה בוחרים בשיטה, משמעות הסימנים והנתונים, השלבים, מלכודות ובדיקה עצמית. הסבר נוסחה במקום שבו משתמשים בה; אל תיצור כרטיסי נוסחאות נפרדים לכל פעולת חשבון פשוטה.\n"
        + "השמט היסטוריה, מנהלה, חזרות ודוגמאות כפולות שאינן נדרשות לפתרון; העבר העמקה שאינה נדרשת כרגע לפרטים מקופלים. אל תשמיט שאלה שהוקצתה, ידע מקדים או הוכחה שנדרשת במפורש. היעדר נושא ממבחנים בודדים אינו ראיה שלא ייבחן.\n"
        + "אם יש מבחנים: ציין מקור, שנה/מועד ושאלה לדפוס שנצפה, והפרד מבחני Moodle של המרצה ממקורות CS24 או מרצים אחרים. ספור רק מה שקראת בפועל ואל תבטיח הצלחה או תחזה את המבחן הבא. אם אין מבחנים או פתרונות: ציין זאת בקצרה ובקש להוסיף מבחני עבר עם פתרונות דרך אזור המבחנים; בינתיים למד לפי שיעורי הבית והסילבוס, בלי לחסום את הסיכום.\n";

    const string CompleteQuestionPolicy =
        "בכל כרטיס תרגיל details.q חובה להציג קודם את נוסח השאלה המלא בבלוק <section class=\"question-statement\" data-source=\"שם קובץ, עמוד, מספר שאלה וסעיף\">. הבלוק יופיע בתחילת qbody, לפני הרמז ולפני details הפתרון. כותרת קצרה, מספר שאלה או קישור ל-PDF אינם תחליף לנוסח.\n"
        + "העתק בנאמנות מהמקור את כל הנתונים, היחידות, התנאים, ההגדרות ומה שנדרש למצוא או להוכיח; הוסף תרשים או טבלה אם השאלה תלויה בהם. לכל סעיף כלול גם את הנתונים המשותפים הדרושים לו. הפרד בבירור בין נתון מהמקור ובין הנחת פתרון. אם המקור חסר או לא קריא, כתוב מה חסר ואל תמציא נוסח או פתרון מספרי.\n"
        + "לאחר הנוסח: נתון/נדרש בקיצור כשזה מועיל, איך מזהים את השיטה, רמז מדורג וקישורים לסעיפים בסיכום, ואז פתרון מלא ומוסבר בתוך details.reveal מקופל. הסבר את המעברים החשובים והוסף בדיקת יחידות/סימן/הצבה. פתרון אינו רשימת תוצאות. סיים בשאלת בדיקה עצמית קצרה כשיש טעות אופיינית.\n"
        + "גם לשאלה שנדחתה יש להציג את הנוסח והמקור; אחריהם הסיבה לדחייה, ללא פתרון מוקדם. תרגיל שנוצר לתרגול יסומן במפורש כתרגיל חדש וב-data-source=\"תרגול שנוצר\". לפני סיום השווה כל נוסח למקור ובדוק שלא חסר אף סעיף. הרץ את scripts/checklinks.py מהשיטה.\n";

    static string QuestionAttribute(string tag, string name)
    {
        var m = Regex.Match(tag, @"\b" + Regex.Escape(name) + @"\s*=\s*(?:""(?<v>[^""]*)""|'(?<v>[^']*)'|(?<v>[^\s>]+))", RegexOptions.IgnoreCase);
        return WebUtility.HtmlDecode(m.Groups["v"].Value);
    }
    static bool QuestionHasClass(string tag, string name) { return QuestionAttribute(tag, "class").Split((char[])null, StringSplitOptions.RemoveEmptyEntries).Contains(name); }

    // Structural check only: the author/reviewer must still compare wording and numbers with the source.
    internal static List<string> MissingQuestionStatements(string html)
    {
        html = Regex.Replace(html, @"<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?</script>|<style\b[^>]*>[\s\S]*?</style>", "", RegexOptions.IgnoreCase);
        var missing = new List<string>();
        var stack = new Stack<Tuple<bool, int, string>>(); int count = 0;
        foreach (Match token in Regex.Matches(html, @"</?details\b[^>]*>", RegexOptions.IgnoreCase)) {
            if (!token.Value.StartsWith("</")) {
                bool question = QuestionHasClass(token.Value, "q");
                if (question) count++;
                stack.Push(Tuple.Create(question, token.Index + token.Length, QuestionAttribute(token.Value, "id")));
            } else if (stack.Count > 0) {
                var frame = stack.Pop(); if (!frame.Item1) continue;
                string body = html.Substring(frame.Item2, token.Index - frame.Item2);
                // Search openings separately, since qbody commonly wraps the entire statement.
                var opening = Regex.Matches(body, @"<(?:section|div|blockquote)\b[^>]*>", RegexOptions.IgnoreCase).Cast<Match>()
                    .FirstOrDefault(m => QuestionHasClass(m.Value, "question-statement"));
                bool valid = false;
                if (opening != null) {
                    string tag = Regex.Match(opening.Value, @"^<(\w+)").Groups[1].Value;
                    int end = body.IndexOf("</" + tag, opening.Index + opening.Length, StringComparison.OrdinalIgnoreCase);
                    var nested = Regex.Match(body, @"<details\b", RegexOptions.IgnoreCase);
                    if (end > opening.Index && (!nested.Success || opening.Index < nested.Index)) {
                        string text = Regex.Replace(body.Substring(opening.Index + opening.Length, end - opening.Index - opening.Length), "<[^>]+>", "");
                        valid = !string.IsNullOrWhiteSpace(WebUtility.HtmlDecode(text)) && QuestionAttribute(opening.Value, "data-source").Trim().Length > 0;
                    }
                }
                if (!valid) missing.Add(frame.Item3.Length > 0 ? frame.Item3 : "תרגיל ללא מזהה");
            }
        }
        foreach (var frame in stack.Where(f => f.Item1)) missing.Add(frame.Item3.Length > 0 ? frame.Item3 : "תרגיל לא סגור");
        if (count == 0) missing.Add("לא נמצאו כרטיסי תרגילים עם נוסח שאלה");
        return missing;
    }

    async Task<AiResult> EnsureCompleteQuestions(string key, string course, int num, AiResult result, Action<string> status)
    {
        string page = StudyPagePath(course, num);
        result = await EnsureTeachingFigures(key, course, num, result, status);
        if (result == null || result.Error || !File.Exists(page)) return result;
        var missing = MissingQuestionStatements(File.ReadAllText(page));
        if (missing.Count == 0) return result;
        status("משלים את נוסחי השאלות מתוך המקור…");
        var repair = await CourseTask(key, course, status, SkillInstruction() + "\n" + CourseContext(course) + "\n" + SummaryScopeInstructions(course, num) + CompleteQuestionPolicy
            + "תקן את דף הסיכום הקיים: \"" + page + "\". בבדיקת המבנה חסרים נוסחים או מקורות בתרגילים: " + string.Join(", ", missing)
            + ". קרא את דפי התרגילים המקוריים והשלם אותם. שמור את הפתרונות, העוגנים ועיצוב הדף; אל תמציא נתונים כדי לעבור את הבדיקה." + WorkAlone);
        if (repair == null || repair.Error) return repair ?? new AiResult { Error = true, Text = "השלמת נוסחי השאלות לא הסתיימה" };
        missing = File.Exists(page) ? MissingQuestionStatements(File.ReadAllText(page)) : new List<string> { "דף הסיכום חסר" };
        if (missing.Count > 0) return new AiResult { Error = true, Provider = result.Provider, Text = "הסיכום עדיין חסר נוסחי שאלות או מקורות: " + string.Join(", ", missing) };
        return result;
    }
}
