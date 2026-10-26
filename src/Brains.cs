using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// ChatGPT and Gemini on the student's own subscription - no API key. Each has a command-line tool that signs in with the
// account in the browser (like logging in to the website) and can then answer a question without any window:
//   ChatGPT:  codex login / codex exec     (a ChatGPT plan)
//   Gemini:   gemini  / gemini -p          (a Google account)
// The app installs them in its own folder, opens the sign-in, and then uses them as helpers next to Claude.
partial class HitStudent
{
    // What the last check found; read without waiting (the check itself runs in the background, see RefreshBrains).
    readonly HashSet<Process> helperRuns = new HashSet<Process>();
    internal bool codexSignedIn;
    internal bool? geminiSignedOverride;   // tests

    // Test hooks: a fake tool in place of the real one.
    static string FindCodex()
    {
        string fake = Environment.GetEnvironmentVariable("SUMIT_CODEX");
        if (!string.IsNullOrEmpty(fake) && File.Exists(fake)) return fake;
        if (FindNode() == null) return null;
        string own = Path.Combine(LocalNpmPrefix, "codex.cmd");
        if (File.Exists(own)) return own;
        string global = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\codex.cmd");
        return File.Exists(global) ? global : FindOnPath("codex.cmd", "codex.exe");
    }

    // Gemini on the student's Google account goes through Google's Antigravity CLI ("agy"): Google ended Gemini CLI for personal accounts
    // on 2026-06-18. The app can't ask agy "am I signed in" without spending a question, so it remembers that a test question was answered.
    static string FindAgy()
    {
        string fake = Environment.GetEnvironmentVariable("SUMIT_AGY");
        if (!string.IsNullOrEmpty(fake) && File.Exists(fake)) return fake;
        string own = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"agy\bin\agy.exe");
        return File.Exists(own) ? own : FindOnPath("agy.exe");
    }
    bool GeminiAccountReady() { return FindAgy() != null && (geminiSignedOverride ?? Bool(settings, "agyOk")); }
    bool ChatGptAccountReady() { return FindCodex() != null && codexSignedIn && (Bool(settings, "chatgptOk") || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SUMIT_CODEX"))); }

    // "account" (the subscription), "key" (an API key), or "" (not connected).
    string HelperMode(string provider)
    {
        if (provider == "gemini") return GeminiAccountReady() ? "account" : HasHelperKey("gemini") ? "key" : "";
        return ChatGptAccountReady() ? "account" : HasHelperKey("openai") ? "key" : "";
    }

    static Dictionary<string, string> CliEnv()
    {
        return new Dictionary<string, string> { { "PATH", NodePath() }, { "NO_COLOR", "1" }, { "CI", "1" } };
    }

    // Runs a tool with the prompt on its standard input (so a long text is no problem) and returns exit code, output, errors.
    async Task<Tuple<int, string, string>> RunCli(string exe, string args, string stdin, string cwd, int timeoutMs, bool loginVerification = false)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = cwd
        };
        foreach (var kv in CliEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
        using (var p = Process.Start(psi))
        {
            helperRuns.Add(p);
            try {
            if (loginVerification) agyLoginProcess = p;
            var outTask = p.StandardOutput.ReadToEndAsync();
            var errTask = p.StandardError.ReadToEndAsync();
            try
            {
                if (stdin != null) { var bytes = new UTF8Encoding(false).GetBytes(stdin); await p.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length); }
                p.StandardInput.Close();
            }
            catch { }
            bool done = await Task.Run(() => {
                var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
                while (!p.WaitForExit(100))
                    if (DateTime.UtcNow >= deadline || (loginVerification && agyLoginCancelled)) return false;
                return true;
            });
            if (!done) { KillTree(p); return Tuple.Create(-2, "", "הזמן הקצוב נגמר"); }
            // The tool's own child processes may keep the pipes open for a moment.
            await Task.WhenAny(Task.WhenAll(outTask, errTask), Task.Delay(4000));
            return Tuple.Create(p.ExitCode, outTask.IsCompleted ? outTask.Result : "", errTask.IsCompleted ? errTask.Result : "");
            } finally { helperRuns.Remove(p); }
        }
    }

    // The whole conversation as one text for a tool that takes a single prompt.
    static string CliPrompt(string system, List<Tuple<string, string>> messages)
    {
        var sb = new StringBuilder(system).Append("\n\n=== השיחה ===\n");
        foreach (var m in messages) sb.Append(m.Item1 == "assistant" ? "עוזר: " : "סטודנט: ").Append(m.Item2).Append("\n\n");
        return sb.Append("ענה עכשיו להודעה האחרונה של הסטודנט, לפי ההנחיות והחומר שלמעלה. אל תשתמש בכלים ואל תקרא או תכתוב קבצים.").ToString();
    }

    // One question, through the subscription.
    async Task<HelperReply> HelperCallCli(string provider, string system, List<Tuple<string, string>> messages, byte[] image = null)
    {
        var reply = new HelperReply { Provider = provider };
        string dir = Path.Combine(Path.GetTempPath(), "SumIT-brain-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);   // an empty folder: the tool has nothing else to read
        try
        {
            string prompt = CliPrompt(system, messages);
            Tuple<int, string, string> r;
            string text = "";
            if (provider == "gemini")
            {
                // Antigravity can't take a long text on its input, so the conversation is a file in the empty folder, read-only ("plan") mode,
                // and the short instruction on the command line says to read it.
                if (image != null) {
                    prompt = prompt.Replace("אל תשתמש בכלים ואל תקרא או תכתוב קבצים.", "מותר לקרוא רק את material.txt ואת selection.png לצורך התשובה; אל תריץ פקודות ואל תכתוב קבצים.");
                    File.WriteAllBytes(Path.Combine(dir, "selection.png"), image);
                    prompt += "\nThe student's selected region is in selection.png in this folder. Read the image to interpret formulas or diagrams. If you cannot view it, say so; do not guess.";
                }
                File.WriteAllText(Path.Combine(dir, "material.txt"), prompt, new UTF8Encoding(false));
                string exe = FindAgy();
                r = await RunCli(exe, "-p " + Q("Read the file material.txt in the current folder. It holds instructions, background material and a conversation. Answer the last student message exactly as the instructions say, in the language they ask for. Do not run commands, do not change files, and reply with the answer only.") + " --mode plan", null, dir, 300000);
                text = r.Item2.Trim();
                if (r.Item3.IndexOf("Authentication required", StringComparison.OrdinalIgnoreCase) >= 0 || r.Item3.IndexOf("authentication failed", StringComparison.OrdinalIgnoreCase) >= 0)
                { settings["agyOk"] = false; SaveSettings(); reply.Error = true; reply.Text = "ההתחברות ל-Google פגה. התחבר שוב בהגדרות"; return reply; }
            }
            else
            {
                string exe = FindCodex();
                if(image!=null)File.WriteAllBytes(Path.Combine(dir,"selection.png"),image);
                string answer = Path.Combine(dir, "answer.txt");
                r = await RunCli(exe, "exec "+(image!=null?"--image "+Q(Path.Combine(dir,"selection.png"))+" ":"")+"--ignore-user-config --skip-git-repo-check -s read-only --ephemeral -o " + Q(answer) + " -", prompt, dir, 240000);
                text = File.Exists(answer) ? File.ReadAllText(answer, Encoding.UTF8).Trim() : "";
            }
            if (r.Item1 != 0 || text.Length == 0)
            {
                reply.Error = true;
                string err = (r.Item3 + " " + r.Item2).ToLowerInvariant();
                reply.Limit = IsUsageLimit(err);
                Diagnostic("helper-cli",provider,FailureKind(err),r.Item1);
                reply.Text = reply.Limit ? "הספק החזיר הגבלת שימוש או קצב (ייתכן זמני). אפשר לנסות מנוע אחר; פרטי הכשל נרשמו בדוח האבחון" : err.Contains("not logged in") || err.Contains("log in") || err.Contains("401") ? "ההתחברות פגה. התחבר שוב בהגדרות" : Trunc((r.Item3.Length > 0 ? r.Item3 : r.Item2).Trim(), 200);
                if (reply.Text.Length == 0) reply.Text = "ה-AI לא החזיר תשובה";
                return reply;
            }
            reply.Text = text;
            return reply;
        }
        catch (Exception ex) { reply.Error = true; reply.Text = ex.Message; return reply; }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    // ---------- Installing and signing in ----------

    async Task InstallCli(string package, string state)
    {
        if (FindNpm() == null)
        {
            setupState = "installing-node"; await SendAiStatus();
            await InstallPortableNode();
            if (FindNpm() == null) throw new Exception("ההתקנה של Node.js נכשלה");
        }
        setupState = state; await SendAiStatus();
        Directory.CreateDirectory(LocalNpmPrefix);
        var r = await Exec(FindNpm(), "install -g --prefix " + Q(LocalNpmPrefix) + " " + package, null, 900000, new Dictionary<string, string> { { "PATH", NodePath() } });
        if (r.Item1 != 0) throw new Exception("ההתקנה נכשלה. " + Trunc(r.Item2, 200));
    }

    // Runs a sign-in tool until it ends, showing its web address in the app if the browser doesn't open by itself.
    async Task RunLogin(string exe, string args, string kind, Func<bool> signedIn, bool answerYes)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Path.GetTempPath()
        };
        foreach (var kv in CliEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
        // A tool that sees CI in its environment never opens a browser (Gemini says "non-interactive session"), so sign-in runs without it.
        psi.EnvironmentVariables.Remove("CI");
        var seen = new StringBuilder();
        string urlSent = null;
        using (var p = Process.Start(psi))
        {
            bool answered = false;
            // The question "[Y/n]:" has no line break after it, so the output is read as it comes, not line by line.
            Action<StreamReader> pump = (reader) => Task.Run(() =>
            {
                var buf = new char[512];
                int n;
                try
                {
                    while ((n = reader.Read(buf, 0, buf.Length)) > 0)
                    {
                        string all;
                        lock (seen) { seen.Append(buf, 0, n); all = seen.ToString(); }
                        if (answerYes && !answered && all.IndexOf("[Y/n]", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            answered = true;
                            try { var yes = new byte[] { (byte)'Y', 13, 10 }; p.StandardInput.BaseStream.Write(yes, 0, yes.Length); p.StandardInput.BaseStream.Flush(); } catch { }   // raw bytes: no encoding preamble in front of the Y
                        }
                    }
                }
                catch { }
            });
            pump(p.StandardOutput); pump(p.StandardError);
            if (!answerYes) { try { p.StandardInput.Close(); } catch { } }
            var started = DateTime.UtcNow;
            while (!p.HasExited && (DateTime.UtcNow - started).TotalMinutes < 6)
            {
                await Task.Delay(1500);
                if (signedIn()) break;
                string text; lock (seen) text = seen.ToString();
                var m = Regex.Match(text, "https://[^\\s\"']+");
                if (m.Success && urlSent != m.Value && (DateTime.UtcNow - started).TotalSeconds > 6)
                { urlSent = m.Value; Send(new { type = "loginUrl", kind = kind, url = m.Value }); }
            }
            if (!p.HasExited) { await Task.Delay(1500); KillTree(p); }
        }
    }

    // Google's own installer for Antigravity CLI (it checks the download's SHA-512 itself and puts agy.exe in the user's folder).
    async Task InstallAgy()
    {
        string script = Path.Combine(Path.GetTempPath(), "sumit-agy-install-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) })
                File.WriteAllText(script, await http.GetStringAsync("https://antigravity.google/cli/install.ps1"), new UTF8Encoding(false));
            var r = await Exec("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Q(script), null, 900000);
            if (FindAgy() == null) throw new Exception("ההתקנה של Gemini נכשלה. " + Trunc(r.Item2, 200));
        }
        finally { try { File.Delete(script); } catch { } }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool FreeConsole();
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteConsoleInput(IntPtr h, ConsoleKeyRecord[] records, uint count, out uint written);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit, Size = 20)]
    struct ConsoleKeyRecord
    {
        [System.Runtime.InteropServices.FieldOffset(0)] public ushort EventType;      // 1 = key event
        [System.Runtime.InteropServices.FieldOffset(4)] public int KeyDown;
        [System.Runtime.InteropServices.FieldOffset(8)] public ushort RepeatCount;
        [System.Runtime.InteropServices.FieldOffset(10)] public ushort VirtualKey;
        [System.Runtime.InteropServices.FieldOffset(12)] public ushort ScanCode;
        [System.Runtime.InteropServices.FieldOffset(14)] public char Char;
        [System.Runtime.InteropServices.FieldOffset(16)] public uint ControlKeys;
    }

    // Presses Enter in another program's (hidden) console: Antigravity's first screen asks how to sign in, and "Google" is the first choice.
    static bool PressEnterIn(int pid)
    {
        try
        {
            FreeConsole();
            if (!AttachConsole((uint)pid)) return false;
            try
            {
                IntPtr h = CreateFile("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);   // read + write, existing
                if (h == IntPtr.Zero || h == new IntPtr(-1)) return false;
                var down = new ConsoleKeyRecord { EventType = 1, KeyDown = 1, RepeatCount = 1, VirtualKey = 0x0D, ScanCode = 0x1C, Char = '\r' };
                var up = down; up.KeyDown = 0;
                uint written;
                bool ok = WriteConsoleInput(h, new[] { down, up }, 2, out written);
                CloseHandle(h);
                return ok;
            }
            finally { FreeConsole(); }
        }
        catch { return false; }
    }

    // Has Antigravity started the Google sign-in since `since`? (Its log says so.)
    static bool AgyOAuthStarted(DateTime sinceUtc)
    {
        try
        {
            string dir = Path.Combine(Home, @".gemini\antigravity-cli\log");
            if (!Directory.Exists(dir)) return false;
            foreach (string f in Directory.GetFiles(dir, "cli-*.log").Where(f => File.GetLastWriteTimeUtc(f) > sinceUtc))
                using (var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sr = new StreamReader(fs))
                    if (sr.ReadToEnd().Contains("consumerOAuth: starting OAuth flow")) return true;
        }
        catch { }
        return false;
    }

    // Presses Enter in the hidden sign-in screen, again and again, until the Google sign-in has started: the screen may first ask
    // other things (such as whether to trust the folder), and each of them is answered by Enter.
    async Task<bool> PushToSignIn(Process p, DateTime sinceUtc)
    {
        int pid = p.Id;
        await Task.Delay(2500);
        for (int i = 0; i < 12 && !p.HasExited; i++)
        {
            await Task.Run<bool>(() => PressEnterIn(pid));
            for (int w = 0; w < 4; w++) { await Task.Delay(500); if (AgyOAuthStarted(sinceUtc)) return true; }
        }
        return AgyOAuthStarted(sinceUtc);
    }

    // Antigravity keeps the signed-in Google account in the Windows credential store, under this name.
    async Task<bool> AgyCredentialPresent()
    {
        string fake = Environment.GetEnvironmentVariable("SUMIT_AGY_CRED");
        if (!string.IsNullOrEmpty(fake)) return File.Exists(fake);
        try { var r = await Exec("cmdkey", "/list", null, 15000); return r.Item2.IndexOf("gemini:antigravity", StringComparison.OrdinalIgnoreCase) >= 0; }
        catch { return false; }
    }

    Process agyLoginProcess;
    volatile bool agyLoginCancelled;
    internal int AgyLoginTimeoutSeconds = 300;

    void CancelAgyLogin()
    {
        agyLoginCancelled = true;
        var p = agyLoginProcess;
        if (p != null) { try { if (!p.HasExited) KillTree(p); } catch { } }
    }

    // Use the official interactive screen. Hidden Enter injection concealed additional
    // questions and manual OAuth steps, leaving the student with an endless spinner.
    async Task<bool> LoginAgy()
    {
        string dir = Path.Combine(Path.GetTempPath(), "SumIT-agy-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        agyLoginCancelled = false;
        try
        {
            bool fake = Environment.GetEnvironmentVariable("SUMIT_AGY") != null;
            var psi = new ProcessStartInfo(FindAgy()) {
                UseShellExecute = false, CreateNoWindow = fake,
                WindowStyle = fake ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal,
                WorkingDirectory = dir
            };
            foreach (string key in new[] { "CI", "NO_BROWSER", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY" }) psi.EnvironmentVariables.Remove(key);
            bool signed = false;
            using (var p = Process.Start(psi))
            {
                agyLoginProcess = p;
                var started = DateTime.UtcNow;
                Send(new { type = "authCode", kind = "gemini", state = "wait", phase = "interactive" });
                while (!p.HasExited && !agyLoginCancelled && (DateTime.UtcNow - started).TotalSeconds < AgyLoginTimeoutSeconds)
                {
                    await Task.Delay(500);
                    if (await AgyCredentialPresent()) { signed = true; break; }
                }
                if (!p.HasExited) KillTree(p);
                agyLoginProcess = null;
            }
            if (agyLoginCancelled) return false;
            if (!signed) signed = await AgyCredentialPresent();
            if (!signed) { settings["agyOk"] = false; SaveSettings(); return false; }
            Send(new { type = "authCode", kind = "gemini", state = "wait", phase = "verify" });
            // Existing credentials alone do not prove that the account can make requests.
            var r = await RunCli(FindAgy(), "-p " + Q("Reply with exactly: READY") + " --mode plan --print-timeout 30s", null, dir, 45000, true);
            bool ok = !agyLoginCancelled && r.Item1 == 0 && Regex.IsMatch(r.Item2, @"(?im)^\s*(?:\*\*)?READY(?:\*\*)?[.!]?\s*$");
            settings["agyOk"] = ok; SaveSettings();
            if (!ok && !agyLoginCancelled) Toast("Google לא אישר חיבור פעיל. נסה שוב או השתמש במפתח API; בדיקת החיבור מוגבלת ל-45 שניות.", true);
            return ok;
        }
        finally
        {
            agyLoginProcess = null;
            Send(new { type = "authCode", kind = "gemini", state = "done" });
            try { Directory.Delete(dir, true); } catch { }
        }
    }

    // Tells Gemini's tool to sign in with a Google account (without it, a tool run without a window has no way to ask which kind of sign-in).
    // Existing settings are kept; only the sign-in type is added when it is missing.
    void EnsureGeminiGoogleAuth()
    {
        try
        {
            Directory.CreateDirectory(GeminiDir);
            string file = Path.Combine(GeminiDir, "settings.json");
            var root = new Dictionary<string, object>();
            if (File.Exists(file))
            {
                try { root = json.DeserializeObject(File.ReadAllText(file, Encoding.UTF8)) as Dictionary<string, object> ?? root; }
                catch { return; }   // a settings file we can't read is left alone
            }
            var security = root.ContainsKey("security") ? root["security"] as Dictionary<string, object> : null;
            if (security == null) { security = new Dictionary<string, object>(); root["security"] = security; }
            var auth = security.ContainsKey("auth") ? security["auth"] as Dictionary<string, object> : null;
            if (auth == null) { auth = new Dictionary<string, object>(); security["auth"] = auth; }
            if (auth.ContainsKey("selectedType")) return;
            auth["selectedType"] = "oauth-personal";
            File.WriteAllText(file, json.Serialize(root), new UTF8Encoding(false));
        }
        catch { }
    }

    async void ConnectBrain(string kind)
    {
        if (setupState.Length > 0) return;
        try
        {
            if (kind == "chatgpt")
            {
                if (FindCodex() == null) await InstallCli("@openai/codex", "installing-codex");
                setupState = "login-chatgpt"; await SendAiStatus();
                await RefreshBrains();   // already signed in on this PC: no browser, the student only links it here
                if (!codexSignedIn) { await RunLogin(FindCodex(), "login", kind, () => false, false); await RefreshBrains(); }
                settings["chatgptOk"] = codexSignedIn; SaveSettings();
                Toast(codexSignedIn ? "ChatGPT חובר, והוא עוזר ל-Claude" : "ההתחברות ל-ChatGPT לא הסתיימה. אפשר לנסות שוב", !codexSignedIn);
            }
            else
            {
                if (FindAgy() == null) { setupState = "installing-gemini"; await SendAiStatus(); await InstallAgy(); }
                setupState = "login-gemini"; await SendAiStatus();
                bool signedIn = await LoginAgy();
                Toast(signedIn ? "Gemini חובר, והוא עוזר ל-Claude" : agyLoginCancelled ? "ההתחברות בוטלה" : "ההתחברות לא הושלמה. השלם את ההוראות בחלון Google Antigravity ונסה שוב.", !signedIn && !agyLoginCancelled);
            }
        }
        catch (Exception ex) { Toast(ex.Message, true); }
        setupState = "";
        await SendAiStatus();
        SendSettings();
    }

    // "Does it really work?": one tiny question to the AI, so the student sees an answer and how long it took.
    // Claude is only asked about its sign-in (a real question would spend its quota for nothing).
    async void TestBrain(string kind)
    {
        string who = kind == "gemini" ? "gemini" : kind == "chatgpt" ? "openai" : "claude";
        var sw = Stopwatch.StartNew();
        try
        {
            if (who == "claude")
            {
                var st = await AiStatus();
                var readyProp = st == null ? null : st.GetType().GetProperty("ready");
                bool claudeReady = readyProp != null && (readyProp.GetValue(st, null) as bool? ?? false);
                Send(new { type = "brainTest", kind = kind, ok = claudeReady, ms = (int)sw.ElapsedMilliseconds, text = claudeReady ? "מחובר" : "לא מחובר" });
                return;
            }
            await RefreshBrains();
            if (HelperMode(who).Length == 0) { Send(new { type = "brainTest", kind = kind, ok = false, ms = 0, text = "לא מחובר" }); return; }
            var r = await HelperAsk("ענה במילה אחת בלבד.", new List<Tuple<string, string>> { Tuple.Create("user", "ענה: מוכן") }, who);
            bool ok = r != null && !r.Error;
            Send(new { type = "brainTest", kind = kind, ok = ok, ms = (int)sw.ElapsedMilliseconds, text = r == null ? "לא מחובר" : Trunc(r.Text.Trim(), 80), mode = HelperMode(who) });
        }
        catch (Exception ex) { Send(new { type = "brainTest", kind = kind, ok = false, ms = (int)sw.ElapsedMilliseconds, text = ex.Message }); }
    }

    async void DisconnectBrain(string kind)
    {
        try
        {
            if (kind == "chatgpt") { settings["chatgptOk"] = false; SaveSettings(); if (FindCodex() != null) await Exec(FindCodex(), "logout", null, 30000, CliEnv()); codexSignedIn = false; }
            else
            {
                // Signs the Google account out of Antigravity (its token is kept in the Windows credential store) and forgets the link.
                settings["agyOk"] = false; SaveSettings();
                if (Environment.GetEnvironmentVariable("SUMIT_AGY") == null) await Exec("cmdkey", "/delete:gemini:antigravity", null, 15000);
            }
        }
        catch (Exception ex) { Toast(ex.Message, true); }
        await RefreshBrains();
        await SendAiStatus();
        SendSettings();
    }

    // Is ChatGPT's tool signed in? Asked in the background, whenever the status is refreshed.
    async Task RefreshBrains()
    {
        string codex = FindCodex();
        if (codex == null) { codexSignedIn = false; return; }
        try
        {
            var r = await Exec(codex, "login status", null, 20000, CliEnv());
            codexSignedIn = r.Item1 == 0 && r.Item2.IndexOf("Logged in", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { codexSignedIn = false; }
    }
}
