using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

partial class HitStudent
{
    const string VisualTeachingPolicy =
        "איכות ההסבר: לפני כלל או נוסחה, כתוב בשפה יומיומית איזו שאלה מנסים לפתור ומה פירוש המושג. אחר כך משמעות הסימנים, דרך הפעולה, דוגמה אחת עם שלב בכל שורה, ומסקנה שמסבירה מה התוצאה אומרת. אל תזרוק אמירות כמו 'הגבול אינו קיים' בלי להסביר מה אמור להתקרב למה ולמה הבדיקה מוכיחה זאת. אל תצמצם הסבר נחוץ לרשימת פסיקים. קצר חומר מיותר, לא את הקשר בין הצעדים.\n"
        + "שרטוטים הם חלק מההסבר: בכל סעיף המלמד שרטוט, תחום מוצל, חיתוך, קווי/משטחי גובה, או השוואה גאומטרית של מסלולים, הצג שרטוט ממשי מתאים לצד ההסבר. אם המרצה או השאלה דורשים ציור, הוא חובה גם בפתרון שיעורי הבית. אין להסתפק ב'שרטטו' או במשוואה. אין להוסיף ציור דקורטיבי לאלגברה שאינה זקוקה לו.\n"
        + "סמן כל כרטיס/סעיף שדורש שרטוט ב-data-visual=\"required\" וב-id קבוע. בתוכו figure עם SVG או תמונה, כיתוב figcaption שמסביר מה רואים ולמה, צירים, יחידות/ערכים, מקרא וגבולות פתוחים/סגורים לפי הצורך. הוסף data-visual-caption לגרף או alt לתמונה כדי שגם קורא טקסט ידע מה מוצג. סמן שאלות שנדחו ב-class=\"q notyet\"; אין לפתור אותן מוקדם.\n"
        + "ודא שהציור נכון מתמטית: דגום את הפונקציה או בנה את הגאומטריה מחישוב מאומת. ציין אם זו המחשה או חתך ולא הגרף המלא. כל דרישת שרטוט בפתרון חייבת להופיע, כולל ערכים מיוחדים. השתמש ברוחב זמין (ברירת מחדל 600–760 פיקסלים במחשב), viewBox תקין, width:100%, height:auto, טקסט קריא וכפתור הגדלה נגיש. אל תכווץ שני ציורים מורכבים לשורה אחת. בדוק תצוגת מחשב, חלון צר והדפסה.\n"
        + "בדיקת הסיכום חייבת לכלול: האם יש הקשר לפני הנוסחה, האם דוגמה נפרדת לשלבים, והאם במקום שמתואר שרטוט יש ציור קריא ותואם. בביקורת טקסט בלבד אין לטעון שנבדק גודל/דיוק חזותי: אפשר לבדוק נוכחות וכיתוב; יש לבקש תיקון מבני/חזותי מפורש כאשר חסר. אל תנסה להכניס SVG דרך החלפת משפט טקסט.\n";

    internal static string SemanticSummaryContext(string html)
    {
        // Retain the entire lesson (including hidden answers and raw LaTeX), not CSS, SVG geometry or embedded images.
        string text = Regex.Replace(html, @"<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<svg\b[^>]*>[\s\S]*?</svg\s*>", m => {
            string tag = Regex.Match(m.Value, @"^<svg\b[^>]*>").Value;
            string caption = QuestionAttribute(tag, "data-visual-caption") + " " + QuestionAttribute(tag, "aria-label");
            string labels = string.Join(" ", Regex.Matches(m.Value, @"<(?:title|desc|text)\b[^>]*>([\s\S]*?)</(?:title|desc|text)>", RegexOptions.IgnoreCase).Cast<Match>().Select(x => Regex.Replace(x.Groups[1].Value, "<[^>]*>", "")));
            return "\n[שרטוט: " + WebUtility.HtmlEncode((caption + " " + WebUtility.HtmlDecode(labels)).Trim()) + "]\n";
        }, RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<img\b[^>]*>", m => "\n[תמונה: " + WebUtility.HtmlEncode(QuestionAttribute(m.Value,"alt")) + "]\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<a\b[^>]*>", m => " [קישור: " + WebUtility.HtmlEncode(QuestionAttribute(m.Value,"href")) + "] ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<(?:h[1-6]|section|details|div)\b[^>]*>", m => {
            string id = QuestionAttribute(m.Value,"id"); return "\n" + (id.Length > 0 ? "[#" + WebUtility.HtmlEncode(id) + "] " : "");
        }, RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</?(?:p|br|li|ul|ol|tr|h[1-6]|section|details|summary|figure|figcaption|div)\b[^>]*>", "\n", RegexOptions.IgnoreCase);
        text = WebUtility.HtmlDecode(Regex.Replace(text,"<[^>]*>"," "));
        return Regex.Replace(Regex.Replace(text,@"[^\S\r\n]+"," "),@"(?:\r?\n\s*){3,}","\n\n").Trim();
    }

    internal static List<Tuple<string,string>> RecentSummaryHistory(List<Tuple<string,string>> history, int budget = 6000)
    {
        var result = new List<Tuple<string,string>>(); int chars=0;
        // Keep complete exchanges; never split formulas or retain an orphaned assistant answer.
        for(int i=history.Count-2;i>=0 && result.Count<6;i-=2) {
            int size=history[i].Item2.Length+history[i+1].Item2.Length;
            if(chars+size>budget)break;
            result.Insert(0,history[i+1]);result.Insert(0,history[i]);chars+=size;
        }
        return result;
    }

    static readonly Dictionary<string,string> LearningHints = new Dictionary<string,string> {
        {"context","פתח במשמעות פשוטה ובמה שמנסים למצוא; הבהר מה משווים ומה המסקנה."},
        {"steps","הסבר את המעבר בין השלבים, עם הצבה אחת מפורשת ושורה נפרדת לכל צעד."},
        {"visual","העדף ציור גדול ומסומן כשיש גרף, תחום, חיתוך או מסלולים."},
        {"plain","השתמש בעברית יומיומית; הגדר מונח חדש לפני השימוש בו."}
    };
    internal static IEnumerable<string> LearningSignals(string question)
    {
        if(Regex.IsMatch(question,"מה (זה|זאת|המשמעות)|קונטקסט|הקשר|קיים|לא קיים"))yield return "context";
        if(Regex.IsMatch(question,"למה|איך|שלב|מעבר|מציב|הצבה|הגעת"))yield return "steps";
        if(Regex.IsMatch(question,"שרט|סרט|ציור|גרף|גרפים|חיתוך|קווי גובה|מסלול"))yield return "visual";
        if(Regex.IsMatch(question,"לא (הבנתי|מבין|מובן)|עברית|פשוט|מסובך|ברור"))yield return "plain";
    }
    string LearningProfileFile(string course) { return Path.Combine(CourseDir(course),SumitDir,"learning-profile.json"); }
    Dictionary<string,object> ReadLearningProfile(string course)
    {
        try { string f=LearningProfileFile(course);if(File.Exists(f)&&new FileInfo(f).Length<4096)return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(f))??new Dictionary<string,object>(); } catch { }
        return new Dictionary<string,object>();
    }
    void RememberLearningNeeds(string course,string question)
    {
        var signals=LearningSignals(question).ToList();if(signals.Count==0)return;
        try {
            var old=ReadLearningProfile(course);var clean=new Dictionary<string,object>();
            foreach(string key in LearningHints.Keys){int count;int.TryParse(Str(old,key),out count);count=Math.Max(0,Math.Min(20,count));if(signals.Contains(key))count=Math.Min(20,count+1);if(count>0)clean[key]=count;}
            string f=LearningProfileFile(course);Directory.CreateDirectory(Path.GetDirectoryName(f));File.WriteAllText(f,json.Serialize(clean));
        }catch { Diagnostic("learning-profile","local","write-failed"); }
    }
    string LearningProfileInstructions(string course)
    {
        var data=ReadLearningProfile(course);var hints=new List<string>();
        foreach(var entry in LearningHints){int count;if(int.TryParse(Str(data,entry.Key),out count)&&count>0)hints.Add(entry.Value);}
        return hints.Count==0?"":"\nדגשים אישיים שנגזרו משאלות קודמות (אינם מוסיפים נושאים להיקף ההרצאה): "+string.Join(" ",hints)+"\n";
    }
    void ResetLearningNeeds(Dictionary<string,object> m)
    {
        try { CheckedSummaryPath(m);string f=LearningProfileFile(Str(m,"course"));if(File.Exists(f))File.Delete(f);Toast("העדפות הלמידה שנלמדו בקורס אופסו",false); }
        catch(Exception ex){Toast(ex.Message,true);}
    }

    class VisualFrame { public string Tag, Id; public int Start; public bool Required, Question, Deferred; }
    internal static List<string> MissingTeachingFigures(string html)
    {
        html=Regex.Replace(html,@"<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>","",RegexOptions.IgnoreCase);
        var stack=new List<VisualFrame>();var missing=new List<string>();
        foreach(Match token in Regex.Matches(html,@"</?([a-z][a-z0-9]*)\b[^>]*>",RegexOptions.IgnoreCase)) {
            string tag=token.Groups[1].Value.ToLowerInvariant();
            if(!token.Value.StartsWith("</")) {
                if(token.Value.EndsWith("/>") || new[]{"img","br","hr","input","meta","link","source","area","wbr","embed","param","col"}.Contains(tag))continue;
                stack.Add(new VisualFrame{Tag=tag,Id=QuestionAttribute(token.Value,"id"),Start=token.Index,Required=QuestionAttribute(token.Value,"data-visual")=="required",Question=tag=="details"&&QuestionHasClass(token.Value,"q"),Deferred=QuestionHasClass(token.Value,"notyet")||QuestionAttribute(token.Value,"data-deferred")=="true"});
                continue;
            }
            int index=stack.FindLastIndex(f=>f.Tag==tag);if(index<0)continue;
            var frame=stack[index];stack.RemoveRange(index,stack.Count-index);
            if(frame.Deferred||(!frame.Required&&!frame.Question))continue;
            string body=html.Substring(frame.Start,token.Index+token.Length-frame.Start);
            bool required=frame.Required;
            if(frame.Question) {
                var statement=Regex.Match(body,@"<(section|div|blockquote)\b(?=[^>]*\bclass\s*=\s*[""'][^""']*question-statement)[^>]*>([\s\S]*?)</\1>",RegexOptions.IgnoreCase);
                required|=statement.Success&&Regex.IsMatch(SemanticSummaryContext(statement.Groups[2].Value),@"שרטט|סרטט|לשרטט|לסרטט|צייר|ציירו|סקיצ");
            }
            bool drawing=Regex.IsMatch(body,@"<svg\b[\s\S]*?<(?:path|circle|ellipse|line|polyline|polygon|rect|use)\b",RegexOptions.IgnoreCase)||Regex.IsMatch(body,@"<img\b[^>]*\bsrc\s*=\s*[""'][^""']+[""']",RegexOptions.IgnoreCase);
            bool caption=Regex.Matches(body,@"<figcaption\b[^>]*>([\s\S]*?)</figcaption>",RegexOptions.IgnoreCase).Cast<Match>().Any(x=>SemanticSummaryContext(x.Groups[1].Value).Length>8);
            if(required&&(!drawing||!caption))missing.Add((frame.Id.Length>0?frame.Id:"סעיף ללא מזהה")+(!drawing?": חסר שרטוט":": חסר הסבר לשרטוט"));
        }
        return missing.Distinct().ToList();
    }
    async Task<AiResult> EnsureTeachingFigures(string key,string course,int num,AiResult result,Action<string> status)
    {
        string page=StudyPagePath(course,num);if(result==null||result.Error||!File.Exists(page))return result;
        var missing=MissingTeachingFigures(File.ReadAllText(page));if(missing.Count==0)return result;
        status("משלים שרטוטים והסברים חסרים…");
        var repair=await CourseTask(key,course,status,SkillInstruction()+"\n"+CourseContext(course)+"\n"+SummaryScopeInstructions(course,num)+CompleteQuestionPolicy
            +"תקן את דף הסיכום הקיים \""+page+"\". נמצאו דרישות שרטוט ללא ציור/כיתוב: "+string.Join("; ",missing)+". קרא את המקורות הרלוונטיים, הוסף שרטוטים נכונים והסבר מה הם מראים. אל תסיר דרישה או סימון כדי לעבור בדיקה. שמור נוסחי שאלות, עוגנים, פתרונות ודחיות. בדוק חזותית את התוצר."+WorkAlone);
        if(repair==null||repair.Error)return repair??new AiResult{Error=true,Text="השלמת השרטוטים לא הסתיימה"};
        missing=File.Exists(page)?MissingTeachingFigures(File.ReadAllText(page)):new List<string>{"דף הסיכום חסר"};
        if(missing.Count>0)return new AiResult{Error=true,Provider=result.Provider,Text="עדיין חסרים שרטוטים או הסברים: "+string.Join("; ",missing)};
        return result;
    }
}
