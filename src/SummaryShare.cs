using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

partial class HitStudent
{
    // Share referenced study files, not the student's notebook, chat, or course metadata.
    static readonly HashSet<string> ShareExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        ".html", ".htm", ".pdf", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot"
    };
    static readonly Regex ShareReferences = new Regex(
        @"(?<attr>\b(?:src|href|poster)\s*=\s*[""'])(?<ref>[^""']+)(?<end>[""'])|(?<attr>url\(\s*[""']?)(?<ref>[^\s)""']+)(?<end>[""']?\s*\))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    static bool ShareText(string path) {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        return ext == ".html" || ext == ".htm" || ext == ".css";
    }

    static Uri ShareFileUri(string path) { return new Uri(new Uri(Path.GetFullPath(path)).AbsoluteUri); }

    static string ShareReferencePath(string source, string reference, string root)
    {
        string value = WebUtility.HtmlDecode(reference).Trim();
        if (value.Length == 0 || value[0] == '#') return null;
        Uri uri;
        if (!Uri.TryCreate(ShareFileUri(source), value, out uri)) return null;
        if (!uri.IsFile) return null;
        string path = Path.GetFullPath(uri.LocalPath);
        if (!IsInside(path, root)) throw new IOException("קישור מקומי מחוץ לקורס אינו ניתן לשיתוף: " + Path.GetFileName(path));
        if (!ShareExtensions.Contains(Path.GetExtension(path))) throw new IOException("סוג קובץ מקושר אינו נתמך לשיתוף: " + Path.GetFileName(path));
        string current = path;
        while (IsInside(current, root)) {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("לא ניתן לארוז קישור לתיקייה או לקובץ אחר: " + Path.GetFileName(current));
            if (string.Equals(current.TrimEnd('\\'), root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) break;
            current = Path.GetDirectoryName(current);
        }
        if (!File.Exists(path)) throw new FileNotFoundException("קובץ מקושר חסר. יש לשחזר אותו לפני השיתוף: " + Path.GetFileName(path));
        return path;
    }

    internal static void BuildSummaryShare(string root, string page, string pdf, string output)
    {
        root = Path.GetFullPath(root);
        page = Path.GetFullPath(page);
        ShareReferencePath(page, new Uri(page).AbsoluteUri, root);
        if (Path.GetExtension(page).ToLowerInvariant() != ".html" && Path.GetExtension(page).ToLowerInvariant() != ".pdf")
            throw new IOException("בחר סיכום HTML או PDF לשיתוף");
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>(); queue.Enqueue(page);
        if (!string.IsNullOrWhiteSpace(pdf)) queue.Enqueue(ShareReferencePath(page, new Uri(Path.GetFullPath(pdf)).AbsoluteUri, root));
        long bytes = 0;
        while (queue.Count > 0) {
            string source = queue.Dequeue();
            if (!files.Add(source)) continue;
            bytes += new FileInfo(source).Length;
            if (files.Count > 3000 || bytes > 300L * 1024 * 1024) throw new IOException("חבילת השיתוף גדולה מדי (עד 300 מגה־בייט)");
            if (ShareText(source)) foreach (Match match in ShareReferences.Matches(File.ReadAllText(source))) {
                string linked = ShareReferencePath(source, match.Groups["ref"].Value, root);
                if (linked != null && !files.Contains(linked)) queue.Enqueue(linked);
            }
        }
        Func<string, string> relative = p => p.Substring(root.TrimEnd('\\').Length + 1).Replace('\\', '/');
        using (var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, false, Encoding.UTF8)) {
            foreach (string file in files) {
                var entry = zip.CreateEntry("files/" + relative(file), CompressionLevel.Optimal);
                using (var dest = entry.Open()) {
                    if (ShareText(file)) {
                        string content = ShareReferences.Replace(File.ReadAllText(file), match => {
                            string linked = ShareReferencePath(file, match.Groups["ref"].Value, root);
                            if (linked == null) return match.Value;
                            var original = new Uri(ShareFileUri(file), WebUtility.HtmlDecode(match.Groups["ref"].Value));
                            string url = ShareFileUri(file).MakeRelativeUri(ShareFileUri(linked)).ToString() + original.Query + original.Fragment;
                            return match.Groups["attr"].Value + url + match.Groups["end"].Value;
                        });
                        byte[] data = Encoding.UTF8.GetBytes(content); dest.Write(data, 0, data.Length);
                    } else using (var source = File.OpenRead(file)) source.CopyTo(dest);
                }
            }
            using(var writer=new StreamWriter(zip.CreateEntry("sumit-share.json").Open(),Encoding.UTF8))
                writer.Write(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new { format="sumit-summary", version=1, entry="files/"+relative(page) }));
            string target = "files/" + string.Join("/", relative(page).Split('/').Select(Uri.EscapeDataString));
            using (var writer = new StreamWriter(zip.CreateEntry("פתח את הסיכום.html").Open(), Encoding.UTF8))
                writer.Write("<!doctype html><html lang=he dir=rtl><meta charset=utf-8><title>פתיחת הסיכום</title><meta http-equiv=refresh content=\"0;url=" + WebUtility.HtmlEncode(target) + "\"><a href=\"" + WebUtility.HtmlEncode(target) + "\">פתח את הסיכום</a></html>");
            using (var writer = new StreamWriter(zip.CreateEntry("הוראות.txt").Open(), Encoding.UTF8))
                writer.Write("אפשר לשלוח את קובץ ה-ZIP ב-WhatsApp כמסמך, או לשמור בתיקיית OneDrive משותפת ולשלוח קישור.\r\nיש לחלץ את כל קובץ ה-ZIP, ואז לפתוח את 'פתח את הסיכום.html' בדפדפן. אין להזיז את הקבצים בנפרד.\r\nהחבילה כוללת את הסיכום, קובצי העיצוב והנוסחאות והקבצים המקומיים המקושרים אליו. קישורים לאתרים חיצוניים דורשים אינטרנט.\r\n");
        }
    }

    bool summaryShareBusy;
    async void ShareSummary(Dictionary<string, object> message)
    {
        string requestId = Str(message, "requestId");
        if (summaryShareBusy) { Send(new { type = "summaryShareResult", requestId = requestId, status = "error", text = "כבר מתבצעת הכנת קובץ לשיתוף" }); return; }
        summaryShareBusy = true;
        string temp = null, status = "cancelled", result = "השמירה בוטלה. אפשר ללחוץ שוב על שיתוף.";
        try {
            string course = Str(message, "course"), page = Str(message, "path"), pdf = Str(message, "pdf");
            string root = CourseDir(course);
            if (course.Length == 0 || !IsInside(root, StudyRoot) || !IsInside(page, root) || !File.Exists(page))
                throw new IOException("הסיכום אינו זמין לשיתוף");
            string destination;
            using (var save = new SaveFileDialog {
                InitialDirectory=Bool(message,"onedrive")?HitOneDrive():"",
                Title = Bool(message,"onedrive")?"בחר תיקייה משותפת מסונכרנת ב-OneDrive":"שמירת הסיכום לשיתוף", Filter = "קובץ ZIP לשיתוף|*.zip",
                FileName = SafeName(course + " - " + Str(message, "title")) + ".zip",
                AddExtension = true, DefaultExt = "zip", OverwritePrompt = true
            }) {
                if (save.ShowDialog(this) != DialogResult.OK) return;
                destination = save.FileName;
            }
            Send(new { type = "summaryShareProgress", requestId = requestId, text = "מכין קובץ ZIP עם הסיכום והקבצים הנדרשים…" });
            temp = Path.Combine(Path.GetDirectoryName(destination), ".sumit-share-" + Guid.NewGuid().ToString("N") + ".tmp");
            await Task.Run(() => BuildSummaryShare(root, page, pdf, temp));
            if (File.Exists(destination)) File.Replace(temp, destination, null);
            else File.Move(temp, destination);
            if(Bool(message,"onedrive")) {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.GetDirectoryName(destination)) { UseShellExecute=true });
                result="ה-ZIP נשמר בתיקייה שבחרת. בתיקייה מסונכרנת הוא יעלה דרך OneDrive; הרשאות השיתוף נקבעות ב-OneDrive.";
            }
            status = "saved";
            if(!Bool(message,"onedrive")) result = "קובץ ה-ZIP נשמר בהצלחה ומוכן לשליחה.";
        }
        catch (Exception ex) { status = "error"; result = "לא הצלחתי לשמור את ה-ZIP: " + ex.Message; }
        finally {
            if (temp != null) { try { if (File.Exists(temp)) File.Delete(temp); } catch { } }
            summaryShareBusy = false;
            Send(new { type = "summaryShareResult", requestId = requestId, status = status, text = result });
        }
    }
}
