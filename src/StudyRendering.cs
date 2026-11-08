using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
partial class HitStudent
{
    internal void PrepareStudyPage(string page)
    {
        if (!File.Exists(page)) return;
        string dir = Path.Combine(Path.GetDirectoryName(page), ".sumit-math");
        Directory.CreateDirectory(dir);
        string source = Path.Combine(WebDir, "vendor", "katex");
        foreach (string f in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string dest = Path.Combine(dir, f.Substring(source.Length + 1));
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            if (!File.Exists(dest) || new FileInfo(dest).Length != new FileInfo(f).Length) File.Copy(f, dest, true);
        }
        File.Copy(Path.Combine(WebDir, "study-math.js"), Path.Combine(dir, "study-math.js"), true);
        string html = File.ReadAllText(page, Encoding.UTF8);
        if (!Regex.IsMatch(html, @"<!doctype\s+html", RegexOptions.IgnoreCase)) html = "<!doctype html>\n" + html;
        html = Regex.Replace(html, @"<!-- sumit-render-start -->[\s\S]*?<!-- sumit-render-end -->", "");
        // Replace only KaTeX CDN resources, preserving the generated page's interactive behavior.
        html = Regex.Replace(html, @"<script\b[^>]*src\s*=\s*['""][^'""]*(?:katex|auto-render)[^'""]*['""][^>]*>\s*</script>", "", RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"<link\b[^>]*href\s*=\s*['""][^'""]*katex[^'""]*['""][^>]*>", "", RegexOptions.IgnoreCase);
        const string resources = "<!-- sumit-render-start --><meta charset=\"utf-8\"><link rel=\"stylesheet\" href=\".sumit-math/katex.min.css\">"
            + "<style>html,body{direction:rtl}body{font-family:'Segoe UI',Arial,sans-serif}p,li,td,th{unicode-bidi:plaintext}.katex,.katex-display,.sumit-math{direction:ltr!important;unicode-bidi:isolate!important}.sumit-math{display:inline-block;max-width:100%}.katex-display{overflow-x:auto;overflow-y:hidden}td .katex,th .katex,td .katex-html,th .katex-html{white-space:nowrap!important}.sumit-math-error{color:#b45309}code,pre{direction:ltr;unicode-bidi:isolate}</style>"
            + "<script defer src=\".sumit-math/katex.min.js\"></script><script defer src=\".sumit-math/study-math.js\"></script><!-- sumit-render-end -->";
        int head = html.LastIndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        html = head >= 0 ? html.Insert(head, resources) : resources + html;
        string temp = page + ".rendering";
        File.WriteAllText(temp, html, new UTF8Encoding(false));
        File.Copy(temp, page, true); File.Delete(temp);
        AddBookLayout(page);
    }
}
