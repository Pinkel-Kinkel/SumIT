using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

partial class HitStudent
{
    static readonly object diagnosticLock = new object();
    static string DiagnosticDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SumIT", "diagnostics"); } }
    internal static string FailureKind(string error)
    {
        if (IsUsageLimit(error)) return "rate-or-quota";
        if (Regex.IsMatch(error ?? "", @"unauthenticated|authentication|not logged|\b401\b|\b403\b", RegexOptions.IgnoreCase)) return "authentication";
        if (Regex.IsMatch(error ?? "", @"unknown option|unrecognized|invalid argument", RegexOptions.IgnoreCase)) return "cli-arguments";
        if (Regex.IsMatch(error ?? "", @"model.*(not found|not supported)|\b404\b", RegexOptions.IgnoreCase)) return "model-unavailable";
        if (Regex.IsMatch(error ?? "", @"timeout|timed out|הזמן הקצוב", RegexOptions.IgnoreCase)) return "timeout";
        if (Regex.IsMatch(error ?? "", @"network|connection|fetch failed|ENOTFOUND", RegexOptions.IgnoreCase)) return "network";
        return "unknown";
    }
    static void Diagnostic(string operation, string provider, string kind, int code = 0)
    {
        try { lock (diagnosticLock) {
            Directory.CreateDirectory(DiagnosticDir);
            string file = Path.Combine(DiagnosticDir, "events.log");
            if (File.Exists(file) && new FileInfo(file).Length > 1024 * 1024) File.Copy(file, file + ".previous", true);
            if (File.Exists(file) && new FileInfo(file).Length > 1024 * 1024) File.WriteAllText(file, "");
            // Only fixed event identifiers and numeric status codes: never prompts, URLs, keys or source content.
            Func<string,string> safe = s => Regex.Replace(s ?? "", "[^A-Za-z0-9_.-]", "");
            File.AppendAllText(file, DateTime.UtcNow.ToString("o") + " version=" + Version + " operation=" + safe(operation) + " provider=" + safe(provider) + " kind=" + safe(kind) + " code=" + code + "\n");
        }} catch { }
    }
    void RecordUiFailure(object message)
    {
        try {
            var m = json.Deserialize<Dictionary<string,object>>(json.Serialize(message));
            if (Bool(m,"error") || Str(m,"status")=="error" || Str(m,"state")=="failed") Diagnostic(Str(m,"type"), "", FailureKind(Str(m,"text")));
        } catch { }
    }
    void ExportDiagnostics()
    {
        using (var dialog = new SaveFileDialog { Title="שמור דוח אבחון לשליחה לתמיכה", Filter="דוח אבחון ZIP|*.zip", FileName="SumIT-diagnostics-"+DateTime.Now.ToString("yyyyMMdd-HHmm")+".zip" }) {
            if (dialog.ShowDialog(this)!=DialogResult.OK) return;
            using (var output=File.Create(dialog.FileName)) using(var zip=new ZipArchive(output,ZipArchiveMode.Create)) {
                using(var writer=new StreamWriter(zip.CreateEntry("system.json").Open(),Encoding.UTF8)) writer.Write(json.Serialize(new {
                    version=Version, os=Environment.OSVersion.ToString(), runtime=Environment.Version.ToString(),
                    geminiMode=HelperMode("gemini"), openaiMode=HelperMode("openai"), claudeConnected=claudeLoggedIn,
                    geminiInstalled=FindAgy()!=null, claudeInstalled=FindClaude()!=null,
                    note="Technical event identifiers only. No settings files, credentials, prompts, course content or browser data."
                }));
                lock(diagnosticLock) foreach(string name in new[]{"events.log","events.log.previous"}) {
                    string file=Path.Combine(DiagnosticDir,name); if(File.Exists(file)) zip.CreateEntryFromFile(file,name);
                }
            }
            Toast("דוח האבחון נשמר. אפשר לשלוח אותו לתמיכה; הוא לא נשלח אוטומטית.",false);
        }
    }

    string cloudImportCourse;
    int cloudImportLecture;
    object SharedSummaries(string course,int num)
    {
        var map=Dict(LoadMeta(course),"sharedSummaries");
        return map!=null && map.ContainsKey(num.ToString()) ? map[num.ToString()] : new object[0];
    }
    internal static string UnpackSharedSummary(string archive,string destination)
    {
        Directory.CreateDirectory(destination);
        var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total=0;
        using(var zip=ZipFile.OpenRead(archive)) {
            if(zip.Entries.Count>3000) throw new IOException("יותר מדי קבצים בחבילה");
            foreach(var entry in zip.Entries) {
                string name=entry.FullName.Replace('\\','/');
                if(name.StartsWith("/") || name.Contains(":") || name.Split('/').Any(p=>p==".." || p.EndsWith(".") || p.EndsWith(" ")) || ((entry.ExternalAttributes>>16)&0xf000)==0xa000) throw new IOException("נתיב לא תקין בחבילת הסיכום");
                string target=Path.GetFullPath(Path.Combine(destination,name.Replace('/',Path.DirectorySeparatorChar)));
                if(!IsInside(target,destination) || !names.Add(target)) throw new IOException("נתיב כפול או מחוץ לחבילה");
                if(name.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                string ext=Path.GetExtension(target);
                if(!ShareExtensions.Contains(ext) && ext!=".txt" && ext!=".json") throw new IOException("סוג קובץ לא נתמך בחבילת הסיכום");
                total+=entry.Length;if(total>300L*1024*1024) throw new IOException("חבילת הסיכום גדולה מדי");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using(var input=entry.Open()) using(var output=new FileStream(target,FileMode.CreateNew)) {
                    byte[] buffer=new byte[81920];int n;long written=0;
                    while((n=input.Read(buffer,0,buffer.Length))>0) { written+=n; if(written>entry.Length) throw new IOException("גודל ZIP לא תקין");output.Write(buffer,0,n); }
                }
            }
        }
        string entryPath=null, manifest=Path.Combine(destination,"sumit-share.json"),launcher=Path.Combine(destination,"פתח את הסיכום.html");
        if(File.Exists(manifest)) {
            var serializer=new System.Web.Script.Serialization.JavaScriptSerializer();
            entryPath=Str(serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(manifest)),"entry");
        } else if(File.Exists(launcher)) {
            var match=Regex.Match(File.ReadAllText(launcher),"href=[\"']([^\"']+)",RegexOptions.IgnoreCase);
            if(match.Success) entryPath=System.Net.WebUtility.HtmlDecode(match.Groups[1].Value);
        }
        if(string.IsNullOrWhiteSpace(entryPath)) throw new IOException("לא נמצא דף פתיחה של סיכום SumIT בחבילה");
        string page=Path.GetFullPath(Path.Combine(destination,Uri.UnescapeDataString(entryPath).Replace('/',Path.DirectorySeparatorChar)));
        if(!IsInside(page,destination) || !File.Exists(page) || !new[]{".html",".htm"}.Contains(Path.GetExtension(page).ToLowerInvariant())) throw new IOException("דף הסיכום בחבילה אינו תקין");
        return page;
    }
    async void ImportSharedSummary(string course,int num,string archive)
    {
        if(string.IsNullOrWhiteSpace(course) || num<1 || num>200) return;
        string destination=Path.Combine(CourseDir(course),SumitDir,"shared",Guid.NewGuid().ToString("N"));
        try {
            string page=await System.Threading.Tasks.Task.Run(()=>UnpackSharedSummary(archive,destination));
            var meta=LoadMeta(course);var map=Dict(meta,"sharedSummaries")??new Dictionary<string,object>();
            var list=map.ContainsKey(num.ToString()) ? ((IEnumerable)map[num.ToString()]).Cast<object>().ToList() : new List<object>();
            list.Add(new { title=Path.GetFileNameWithoutExtension(archive),path=page });map[num.ToString()]=list;meta["sharedSummaries"]=map;SaveMeta(course,meta);
            SendSectionLocal(course,num);Toast("סיכום החבר נוסף להרצאה "+num+". הסיכום הקיים נשמר.",false);Diagnostic("summary-import","","success");
        } catch(Exception ex) { Diagnostic("summary-import","",ex.GetType().Name);Toast("ייבוא הסיכום נכשל: "+ex.Message,true); }
    }
    void PickSharedSummary(Dictionary<string,object> m)
    {
        string file=null;
        if(Bool(m,"clipboard") && Clipboard.ContainsFileDropList()) file=Clipboard.GetFileDropList().Cast<string>().FirstOrDefault(p=>p.EndsWith(".zip",StringComparison.OrdinalIgnoreCase));
        if(file==null) using(var dialog=new OpenFileDialog { Title="בחר ZIP של סיכום חבר",Filter="סיכום ZIP|*.zip",InitialDirectory=Bool(m,"onedrive")?HitOneDrive():"" }) {
            if(dialog.ShowDialog(this)!=DialogResult.OK)return;file=dialog.FileName;
        }
        ImportSharedSummary(Str(m,"course"),Int(m,"num"),file);
    }
    static bool IsOneDrivePage(string value)
    {
        Uri uri;return Uri.TryCreate(value,UriKind.Absolute,out uri) && (uri.Host.Equals("onedrive.live.com",StringComparison.OrdinalIgnoreCase)||uri.Host.EndsWith(".sharepoint.com",StringComparison.OrdinalIgnoreCase));
    }
}
