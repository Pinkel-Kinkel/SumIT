using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;

// Which summaries were made in the current format. Format 2 is "homework first": every question carries what is needed to solve it.
// Older summaries are still readable (and open on the homework page), and one button rebuilds them in the new format, one at a time.
partial class HitStudent
{
    const int SummaryFormat = 2;
    string FormatFile(string course, int num) { return Path.Combine(CourseDir(course), SumitDir, "format", num + ".txt"); }

    void MarkSummaryFormat(string course, int num)
    {
        try { string f = FormatFile(course, num); Directory.CreateDirectory(Path.GetDirectoryName(f)); File.WriteAllText(f, SummaryFormat.ToString()); } catch { }
    }

    internal List<Tuple<string, int, string>> OutdatedSummaries()
    {
        var list = new List<Tuple<string, int, string>>();
        try
        {
            if (string.IsNullOrEmpty(StudyRoot) || !Directory.Exists(StudyRoot)) return list;
            foreach (string cd in Directory.GetDirectories(StudyRoot))
            {
                string course = Path.GetFileName(cd);
                var meta = LoadMeta(course);
                var rows = meta.ContainsKey("lectures") ? meta["lectures"] as ArrayList : null;
                if (rows == null) continue;
                foreach (Dictionary<string, object> r in rows.OfType<Dictionary<string, object>>())
                {
                    int n = Int(r, "num");
                    if (n < 1 || !File.Exists(StudyPagePath(course, n))) continue;
                    string f = FormatFile(course, n);
                    if ((File.Exists(f) ? File.ReadAllText(f).Trim() : "") != SummaryFormat.ToString()) list.Add(Tuple.Create(course, n, Str(r, "title")));
                }
            }
        }
        catch { }
        return list;
    }

    // Queues every older summary for a rebuild. The queue runs them one at a time and keeps the old summary if a rebuild fails.
    void RefreshOutdatedSummaries()
    {
        var list = OutdatedSummaries();
        if (list.Count == 0) { Toast("כל הסיכומים כבר בפורמט החדש", false); SendSettings(); return; }
        foreach (var s in list) { var queued = LecturePdfAsync(s.Item1, s.Item2, s.Item3, false, true); }
        Toast(list.Count == 1 ? "סיכום אחד נכנס לתור" : list.Count + " סיכומים נכנסו לתור, ייבנו אחד אחרי השני", false);
    }
}