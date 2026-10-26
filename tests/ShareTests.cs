using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
class ShareTests {
    static void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); }
    [STAThread] static void Main(string[] args) {
        string root = Path.Combine(Path.GetTempPath(), "SumIT-share-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "summary", ".math", "fonts"));
        Directory.CreateDirectory(Path.Combine(root, "exercises"));
        string page = Path.Combine(root, "summary", "page.html"), zip = Path.Combine(root, "test.zip");
        File.WriteAllText(Path.Combine(root, "summary", ".math", "style.css"), "@font-face{src:url('fonts/test.woff2')}");
        File.WriteAllText(Path.Combine(root, "summary", ".math", "fonts", "test.woff2"), "font");
        File.WriteAllText(Path.Combine(root, "exercises", "תרגיל.pdf"), "pdf");
        File.WriteAllText(Path.Combine(root, "private-notebook.pdf"), "private");
        File.WriteAllText(page, "<link href='.math/style.css'><a href='../exercises/%D7%AA%D7%A8%D7%92%D7%99%D7%9C.pdf#page=2'>PDF</a><a href='#x'>anchor</a><a href='https://example.org/'>web</a>");
        HitStudent.BuildSummaryShare(root, page, "", zip);
        using (var z = ZipFile.OpenRead(zip)) {
            Check(z.Entries.Any(e => e.FullName.EndsWith("fonts/test.woff2")), "CSS font dependency included");
            Check(z.Entries.Any(e => e.FullName.EndsWith("תרגיל.pdf")), "Hebrew linked PDF included");
            Check(!z.Entries.Any(e => e.FullName.Contains("private")), "unreferenced private files excluded");
            Check(z.Entries.Any(e => e.FullName == "פתח את הסיכום.html"), "entry page included");
            using (var r = new StreamReader(z.GetEntry("files/summary/page.html").Open())) Check(r.ReadToEnd().Contains("#page=2"), "PDF fragment retained");
        }
        string unpacked=HitStudent.UnpackSharedSummary(zip,Path.Combine(root,"imported"));
        Check(File.Exists(unpacked) && File.Exists(Path.Combine(root,"imported","files","summary",".math","fonts","test.woff2")),"shared summary imports with relative assets intact");
        string malicious=Path.Combine(root,"malicious.zip");
        using(var z=ZipFile.Open(malicious,ZipArchiveMode.Create)) using(var w=new StreamWriter(z.CreateEntry("../escape.html").Open())) w.Write("bad");
        bool blocked=false;try{HitStudent.UnpackSharedSummary(malicious,Path.Combine(root,"malicious-out"));}catch(IOException){blocked=true;}
        Check(blocked && !File.Exists(Path.Combine(root,"escape.html")),"ZIP traversal blocked");
        using(var z=ZipFile.Open(zip,ZipArchiveMode.Update))z.GetEntry("sumit-share.json").Delete();
        Check(File.Exists(HitStudent.UnpackSharedSummary(zip,Path.Combine(root,"legacy"))),"older shared ZIP without manifest imports");
        File.WriteAllText(page, "<img src='missing.png'>");
        bool failed = false; try { HitStudent.BuildSummaryShare(root, page, "", Path.Combine(root, "missing.zip")); } catch (FileNotFoundException) { failed = true; }
        Check(failed, "missing local asset reported");
        File.WriteAllText(page, "<a href='../../outside.pdf'>outside</a>");
        failed = false; try { HitStudent.BuildSummaryShare(root, page, "", Path.Combine(root, "outside.zip")); } catch (IOException) { failed = true; }
        Check(failed, "outside-course links refused");
        if (args.Length == 3) {
            HitStudent.BuildSummaryShare(args[0], args[1], "", args[2]);
            using (var z = ZipFile.OpenRead(args[2])) Console.WriteLine("PASS actual lecture bundle: " + z.Entries.Count + " entries");
        }
    }
}
