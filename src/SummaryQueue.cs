using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
partial class HitStudent
{
    bool shuttingDown, summariesRecovered;
    Func<string, int, Task<AiResult>> summaryWorkOverride; // Offline lifecycle regression seam.
    readonly SemaphoreSlim summaryGate = new SemaphoreSlim(1, 1);
    readonly SemaphoreSlim printGate = new SemaphoreSlim(1, 1);
    readonly SemaphoreSlim aiGate = new SemaphoreSlim(1, 1);
    readonly HashSet<string> summaryQueued = new HashSet<string>();
    string PendingSummary(string course, int num) { return Path.Combine(CourseDir(course), SumitDir, "pending-summary-" + num + ".json"); }
    void SavePendingSummary(string course, int num, string title, bool force, bool running = false)
    {
        string file = PendingSummary(course, num); Directory.CreateDirectory(Path.GetDirectoryName(file));
        string temp = file + ".tmp";
        File.WriteAllText(temp, json.Serialize(new { course = course, num = num, title = title, force = force, running = running }));
        if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
    }
    async Task<AiResult> LecturePdfAsync(string course, int num, string title, bool open = false, bool force = false)
    {
        string key = course + "|" + num;
        if (shuttingDown || num < 1 || num > 200 || !summaryQueued.Add(key)) return null;
        bool ignored; aiStopped.TryRemove("sum|" + key, out ignored);
        try { SavePendingSummary(course, num, title, force); }
        catch (Exception ex) { summaryQueued.Remove(key); SectionStatus(course, num, ex.Message, false, true); return new AiResult { Error = true, Text = ex.Message }; }
        SectionStatus(course, num, "בתור להכנת סיכום — העבודה נשמרה", true, false);
        await summaryGate.WaitAsync();
        string page = StudyPagePath(course, num), backup = page + ".previous", partial = page + ".interrupted";
        string digest = Path.Combine(CourseDir(course), DigestRel(num).Replace('/', '\\'));
        bool hadPage = File.Exists(page), hadDigest = File.Exists(digest), success = false;
        string oldDigest = hadDigest ? File.ReadAllText(digest) : null;
        try
        {
            if (shuttingDown) return null;
            if (Stopped("sum|" + key))
            {
                if (File.Exists(PendingSummary(course, num))) File.Delete(PendingSummary(course, num));
                success = true;
                SectionStatus(course, num, "הסיכום נעצר. אפשר להתחיל שוב מתי שתרצה", false, false);
                SendSectionLocal(course, num);
                return null;
            }
            if (hadPage) File.Copy(page, backup, true);
            if (hadDigest) File.Copy(digest, digest + ".previous", true);
            SavePendingSummary(course, num, title, force, true);
            // A prior process may have stopped mid-write. Never serve that as a complete summary.
            string pdf = LecturePdfPath(course, num);
            if (File.Exists(pdf)) File.Copy(pdf, pdf + ".previous", true);
            var result = summaryWorkOverride != null ? await summaryWorkOverride(course, num) : await LecturePdfCoreAsync(course, num, title, open, force);
            success = !shuttingDown && (result == null || !result.Error) && File.Exists(page);
            if (!shuttingDown && File.Exists(PendingSummary(course, num))) File.Delete(PendingSummary(course, num));
            return result;
        }
        catch (Exception ex)
        {
            if (!shuttingDown) SectionStatus(course, num, "הסיכום לא הושלם; אפשר לנסות שוב: " + Trunc(ex.Message, 120), false, true);
            return new AiResult { Error = true, Text = ex.Message };
        }
        finally
        {
            if (!success)
            {
                string pdf = LecturePdfPath(course, num);
                if (File.Exists(pdf + ".previous")) File.Copy(pdf + ".previous", pdf, true);
                if (File.Exists(page)) File.Copy(page, partial, true);
                if (File.Exists(backup)) File.Copy(backup, page, true); else if (!hadPage && File.Exists(page)) File.Delete(page);
                if (hadDigest) File.WriteAllText(digest, oldDigest); else if (File.Exists(digest)) File.Delete(digest);
            }
            if (success && File.Exists(backup)) File.Delete(backup);
            summaryQueued.Remove(key); summaryRunning.Remove(key); summaryProgress.Remove(key);
            bool wasStopped; aiStopped.TryRemove("sum|" + key, out wasStopped);
            summaryGate.Release();
        }
    }
    async void RecoverSummaries()
    {
        if (summariesRecovered || shuttingDown || !Directory.Exists(StudyRoot)) return;
        if (!AiReadyOrSay(t => { })) return;
        summariesRecovered = true;
        foreach (string courseDir in Directory.GetDirectories(StudyRoot))
        {
            string metadata = Path.Combine(courseDir, SumitDir);
            if (!Directory.Exists(metadata)) continue;
            foreach (string file in Directory.GetFiles(metadata, "pending-summary-*.json"))
            {
                try
                {
                    var job = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
                    string course = Str(job, "course"); int num = Int(job, "num");
                    if (!string.Equals(Path.GetFullPath(file), Path.GetFullPath(PendingSummary(course, num)), StringComparison.OrdinalIgnoreCase)) continue;
                    if (summaryQueued.Contains(course + "|" + num)) continue;
                    string page = StudyPagePath(course, num);
                    if (Bool(job, "running")) {
                    string pdf = LecturePdfPath(course, num);
                    if (File.Exists(pdf + ".previous")) File.Copy(pdf + ".previous", pdf, true);
                    string digest = Path.Combine(CourseDir(course), DigestRel(num).Replace('/', '\\'));
                    if (File.Exists(digest + ".previous")) File.Copy(digest + ".previous", digest, true); else if (File.Exists(digest)) File.Delete(digest);
                    if (File.Exists(page + ".previous")) File.Copy(page + ".previous", page, true);
                    else if (File.Exists(page)) { File.Copy(page, page + ".interrupted", true); File.Delete(page); }
                    }
                    await LecturePdfAsync(course, num, Str(job, "title"), false, Bool(job, "force"));
                }
                catch (Exception ex) { if (!shuttingDown) Toast("לא ניתן לשחזר סיכום: " + Trunc(ex.Message, 100), true); }
                if (shuttingDown) return;
            }
        }
    }
}
