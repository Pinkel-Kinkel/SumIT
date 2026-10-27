'use strict';
// Port of src/Brains.cs (adapted for macOS Keychain, Terminal sign-in, and Unix CLI binaries).

const fs = require('fs');
const path = require('path');
const { Str, Bool, Trunc, FindOnPath, Exec, spawnTracked, killTree, delay, guidN, fileExists, dirExists, mkdirp, readText, writeText } = require('../util');
const platform = require('../platform');

function CliPrompt(system, messages) {
  let sb = (system || '') + '\n\n=== השיחה ===\n';
  for (const m of messages || []) {
    sb += (m[0] === 'assistant' ? 'עוזר: ' : 'סטודנט: ') + m[1] + '\n\n';
  }
  return sb + 'ענה עכשיו להודעה האחרונה של הסטודנט, לפי ההנחיות והחומר שלמעלה. אל תשתמש בכלים ואל תקרא או תכתוב קבצים.';
}

// agy --output-format stream-json prints one JSON event per line. The answer is the text of the last agent_response
// step (a step before a tool call, like "reading the file", is replaced by the next one). Calls onText(delta, full).
function AgyStreamParser(onText) {
  let buf = '', step = -1, text = '';
  return (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const s = o && o.event === 'step_update' ? o.step_update : null;
      if (!s || s.step_type !== 'agent_response' || !s.text_delta) continue;
      if (s.step_index !== step) { step = s.step_index; text = ''; }
      text += s.text_delta;
      try { onText(s.text_delta, text); } catch { }
    }
  };
}

// The final answer from stream-json output; plain-text output (an older CLI) is returned as is.
function AgyStreamAnswer(stdout) {
  let events = false;
  for (const line of stdout.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || !o.event) continue;
    events = true;
    if (o.event === 'result' && o.result) return Str(o.result, 'response').trim();
  }
  return events ? '' : stdout.trim();
}

function AgyOAuthStarted(sinceMs) {
  try {
    const dir = path.join(platform.Home, '.gemini', 'antigravity-cli', 'log');
    if (!dirExists(dir)) return false;
    for (const n of fs.readdirSync(dir)) {
      if (!/^cli-.*\.log$/.test(n)) continue;
      const f = path.join(dir, n);
      if (fs.statSync(f).mtimeMs > sinceMs && readText(f).includes('consumerOAuth: starting OAuth flow')) return true;
    }
  } catch { }
  return false;
}

module.exports = {
  init(host) {
    host.codexSignedIn = false;
    host.geminiSignedOverride = null;
    host.agyLoginProcess = null;
    host.agyLoginCancelled = false;
    host.AgyLoginTimeoutSeconds = 300;
  },
  methods: {
    CliPrompt,
    AgyOAuthStarted,

    FindCodex() {
      const fake = process.env.SUMIT_CODEX;
      if (fake && fileExists(fake)) return fake;
      if (!this.FindNode()) return null;
      const own = path.join(this.LocalNpmPrefix, 'bin', 'codex');
      if (fileExists(own)) return own;
      return FindOnPath('codex');
    },

    FindAgy() {
      const fake = process.env.SUMIT_AGY;
      if (fake && fileExists(fake)) return fake;
      for (const p of [
        path.join(platform.Home, '.antigravity', 'bin', 'agy'),
        path.join(platform.Home, '.agy', 'bin', 'agy'),
        path.join(platform.Home, '.local', 'bin', 'agy'),
      ]) {
        if (fileExists(p)) return p;
      }
      return FindOnPath('agy');
    },

    GeminiAccountReady() {
      return this.FindAgy() !== null && (this.geminiSignedOverride !== null ? this.geminiSignedOverride : Bool(this.settings, 'agyOk'));
    },

    ChatGptAccountReady() {
      return this.FindCodex() !== null && this.codexSignedIn && (Bool(this.settings, 'chatgptOk') || !!process.env.SUMIT_CODEX);
    },

    HelperMode(provider) {
      if (provider === 'gemini') return this.GeminiAccountReady() ? 'account' : this.HasHelperKey('gemini') ? 'key' : '';
      return this.ChatGptAccountReady() ? 'account' : this.HasHelperKey('openai') ? 'key' : '';
    },

    get AgyModel() {
      const m = Str(this.settings, 'geminiModel').trim();
      const valid = ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high', 'claude-sonnet-5-5-low', 'gemini-4-argon-low', 'gemini-4-argon-medium'];
      if (m && valid.includes(m)) return m;
      return 'gemini-3.8-flash-low';
    },

    AgyModelCandidates() {
      const primary = this.AgyModel;
      const list = [primary, 'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'claude-sonnet-5-5-low', 'gemini-3.8-flash-high', 'gemini-4-argon-low'];
      return Array.from(new Set(list));
    },

    CliEnv() {
      return { PATH: this.NodePath(), NO_COLOR: '1', CI: '1' };
    },

    // Returns { code, stdout, stderr } (C# returned Tuple<int, string, string>).
    RunCli(exe, args, stdin, cwd, timeoutMs, loginVerification = false, onStdout = null) {
      return new Promise((resolve) => {
        let stdout = '', stderr = '', settled = false;
        let p;
        try {
          p = spawnTracked(exe, args, { cwd: cwd || undefined, env: this.CliEnv() });
        } catch (ex) {
          resolve({ code: -1, stdout: '', stderr: ex.message || String(ex) });
          return;
        }
        this.helperRuns.add(p);
        if (loginVerification) this.agyLoginProcess = p;
        const finish = (code, errOverride) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(cancelPoller);
          this.helperRuns.delete(p);
          resolve({ code, stdout, stderr: errOverride !== undefined ? errOverride : stderr });
        };
        const timer = setTimeout(() => { killTree(p); finish(-2, 'הזמן הקצוב נגמר'); }, timeoutMs);
        const cancelPoller = loginVerification ? setInterval(() => {
          if (this.agyLoginCancelled) { killTree(p); finish(-2, 'בוטל'); }
        }, 150) : null;
        p.stdout.on('data', d => { stdout += d; if (onStdout) onStdout(String(d)); });
        p.stderr.on('data', d => stderr += d);
        p.on('error', e => finish(-1, e.message || String(e)));
        p.on('close', code => finish(code === null ? -2 : code));
        try {
          if (stdin !== null && stdin !== undefined) p.stdin.write(stdin, 'utf8');
          p.stdin.end();
        } catch { }
      });
    },

    // opts.fast (the summary chat): low-effort models, and a short prompt goes straight into -p instead of a file the
    // agent must open first - that tool round trip roughly doubled the wait. opts.onChunk(delta, full) streams the answer.
    async HelperCallCli(provider, system, messages, imageBuffer = null, opts = {}) {
      const reply = { Text: '', Provider: provider, Error: false, Limit: false };
      const dir = path.join(platform.TempDir, 'SumIT-brain-' + guidN());
      mkdirp(dir);
      try {
        let prompt = CliPrompt(system, messages);
        let r, text = '';
        if (provider === 'gemini') {
          if (imageBuffer) {
            prompt = prompt.replace('אל תשתמש בכלים ואל תקרא או תכתוב קבצים.', 'מותר לקרוא רק את material.txt ואת selection.png לצורך התשובה; אל תריץ פקודות ואל תכתוב קבצים.');
            fs.writeFileSync(path.join(dir, 'selection.png'), imageBuffer);
            prompt += '\nThe student\'s selected region is in selection.png in this folder. Read the image to interpret formulas or diagrams. If you cannot view it, say so; do not guess.';
          }
          const inline = opts.fast && !imageBuffer && prompt.length <= 100000;
          let pArgs = prompt;
          if (!inline) {
            writeText(path.join(dir, 'material.txt'), prompt);
            pArgs = 'Read the file material.txt in the current folder. It holds instructions, background material and a conversation. Answer the last student message exactly as the instructions say, in the language they ask for. Do not run commands, do not change files, and reply with the answer only.';
          }
          let exe = this.FindAgy();
          const models = opts.fast ? Array.from(new Set(this.AgyModelCandidates().map(m => m.replace(/-(medium|high)$/, '-low')))) : this.AgyModelCandidates();
          const stream = typeof opts.onChunk === 'function';
          for (const mod of models) {
            const args = ['-p', pArgs, '--mode', 'plan', '--model', mod].concat(stream ? ['--output-format', 'stream-json'] : []);
            r = await this.RunCli(exe, args, null, dir, 300000, false, stream ? AgyStreamParser(opts.onChunk) : null);
            text = stream ? AgyStreamAnswer(r.stdout) : r.stdout.trim();
            if (/Authentication required|authentication failed/i.test(r.stderr)) {
              this.settings.agyOk = false;
              this.SaveSettings();
              reply.Error = true;
              reply.Text = 'ההתחברות ל-Google פגה. התחבר שוב בהגדרות';
              return reply;
            }
            if (r.code === 0 && text.length > 0) break;
            const errLower = (r.stderr + ' ' + r.stdout).toLowerCase();
            const isLimit = errLower.includes('usage limit') || errLower.includes('rate limit') || errLower.includes('quota') || errLower.includes('429');
            if (!isLimit) break;
          }
        } else {
          const exe = this.FindCodex();
          const answer = path.join(dir, 'answer.txt');
          if(imageBuffer)fs.writeFileSync(path.join(dir,'selection.png'),imageBuffer);
          r = await this.RunCli(exe, ['exec', ...(imageBuffer?['--image',path.join(dir,'selection.png')]:[]), '--ignore-user-config', '--skip-git-repo-check', '-s', 'read-only', '--ephemeral', '-o', answer, '-'], prompt, dir, 240000);
          text = fileExists(answer) ? readText(answer).trim() : '';
        }
        if (r.code !== 0 || text.length === 0) {
          reply.Error = true;
          const err = (r.stderr + ' ' + r.stdout).toLowerCase();
          reply.Limit = this.FailureKind(err)==='rate-or-quota';
          this.Diagnostic('helper-cli',provider,this.FailureKind(err),r.code);
          reply.Text = reply.Limit ? 'הספק החזיר הגבלת שימוש או קצב, ייתכן זמנית. פרטי התקלה נרשמו בדוח האבחון'
            : (err.includes('not logged in') || err.includes('log in') || err.includes('401')) ? 'ההתחברות פגה. התחבר שוב בהגדרות'
            : Trunc((r.stderr.length > 0 ? r.stderr : r.stdout).trim(), 200);
          if (reply.Text.length === 0) reply.Text = 'ה-AI לא החזיר תשובה';
          return reply;
        }
        reply.Text = text;
        return reply;
      } catch (ex) {
        reply.Error = true;
        reply.Text = ex.message || String(ex);
        return reply;
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
      }
    },

    // Several turns of one Gemini conversation in a single agy process (each turn sees the earlier ones), so a multi-step
    // job pays the CLI start-up once. Low-effort models. onTurn(n) after each answered turn. Returns { Texts, Error, Text }.
    async HelperCallCliTurns(turns, onTurn = null) {
      const reply = { Texts: [], Provider: 'gemini', Error: false, Limit: false, Text: '' };
      const dir = path.join(platform.TempDir, 'SumIT-brain-' + guidN());
      mkdirp(dir);
      try {
        const exe = this.FindAgy();
        const stdin = turns.map(t => JSON.stringify({ event: 'user', message: { role: 'user', content: t } })).join('\n') + '\n';
        let r;
        for (const mod of Array.from(new Set(this.AgyModelCandidates().map(m => m.replace(/-(medium|high)$/, '-low'))))) {
          const texts = [];
          let buf = '';
          const onStdout = (chunk) => {
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
              let o;
              try { o = JSON.parse(line); } catch { continue; }
              if (o && o.event === 'result' && o.result) { texts.push(Str(o.result, 'response').trim()); if (onTurn) try { onTurn(texts.length); } catch { } }
            }
          };
          r = await this.RunCli(exe, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan', '--model', mod, '--print='], stdin, dir, 300000, false, onStdout);
          if (/Authentication required|authentication failed/i.test(r.stderr)) {
            this.settings.agyOk = false;
            this.SaveSettings();
            return Object.assign(reply, { Error: true, Text: 'ההתחברות ל-Google פגה. התחבר שוב בהגדרות' });
          }
          if (r.code === 0 && texts.length === turns.length && texts.every(t => t.length > 0)) return Object.assign(reply, { Texts: texts });
          const err = (r.stderr + ' ' + r.stdout).toLowerCase();
          reply.Limit = err.includes('usage limit') || err.includes('rate limit') || err.includes('quota') || err.includes('429');
          if (!reply.Limit) break;
        }
        return Object.assign(reply, { Error: true, Text: reply.Limit ? 'המכסה של המנוי נגמרה לעכשיו' : Trunc(r.stderr.trim(), 200) || 'ה-AI לא החזיר תשובה' });
      } catch (ex) {
        return Object.assign(reply, { Error: true, Text: ex.message || String(ex) });
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
      }
    },

    async InstallCli(pkg, state) {
      if (!this.FindNpm()) {
        this.setupState = 'installing-node';
        await this.SendAiStatus();
        await this.InstallPortableNode();
        if (!this.FindNpm()) throw new Error('ההתקנה של Node.js נכשלה');
      }
      this.setupState = state;
      await this.SendAiStatus();
      mkdirp(this.LocalNpmPrefix);
      const r = await Exec(this.FindNpm(), ['install', '-g', '--prefix', this.LocalNpmPrefix, pkg], null, 900000, { PATH: this.NodePath() });
      if (r.code !== 0) throw new Error('ההתקנה נכשלה. ' + Trunc(r.output, 200));
    },

    async RunLogin(exe, args, kind, signedIn, answerYes) {
      const env = Object.assign({}, this.CliEnv());
      delete env.CI;
      let seen = '';
      let urlSent = null;
      let answered = false;
      const p = spawnTracked(exe, Array.isArray(args) ? args : [args], { cwd: platform.TempDir, env });
      const onChunk = (chunk) => {
        seen += chunk;
        if (answerYes && !answered && /\[Y\/n\]/i.test(seen)) {
          answered = true;
          try { p.stdin.write('Y\n'); } catch { }
        }
      };
      p.stdout.on('data', onChunk);
      p.stderr.on('data', onChunk);
      if (!answerYes) { try { p.stdin.end(); } catch { } }
      let exited = false;
      p.on('close', () => { exited = true; });
      const started = Date.now();
      while (!exited && (Date.now() - started) < 6 * 60 * 1000) {
        await delay(1500);
        if (await signedIn()) break;
        const m = /https:\/\/[^\s"']+/.exec(seen);
        if (m && urlSent !== m[0] && (Date.now() - started) > 6000) {
          urlSent = m[0];
          this.Send({ type: 'loginUrl', kind, url: m[0] });
        }
      }
      if (!exited) { await delay(1500); killTree(p); }
    },

    async InstallAgy() {
      const script = path.join(platform.TempDir, 'sumit-agy-install-' + guidN() + '.sh');
      try {
        const resp = await fetch('https://antigravity.google/cli/install.sh', { signal: AbortSignal.timeout(60000) });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        writeText(script, await resp.text());
        const r = await Exec('/bin/bash', [script], null, 900000);
        if (!this.FindAgy()) throw new Error('ההתקנה של Gemini נכשלה. ' + Trunc(r.output, 200));
      } finally {
        try { if (fileExists(script)) fs.unlinkSync(script); } catch { }
      }
    },

    async AgyCredentialPresent() {
      const fake = process.env.SUMIT_AGY_CRED;
      if (fake) return fileExists(fake);
      try {
        const r = await Exec('/usr/bin/security', ['find-generic-password', '-s', 'gemini:antigravity'], null, 10000);
        if (r.code === 0) return true;
        for (const f of [
          path.join(platform.Home, '.gemini', 'antigravity-cli', 'credentials.json'),
          path.join(platform.Home, '.gemini', 'oauth_creds.json'),
        ]) {
          if (fileExists(f)) return true;
        }
        return false;
      } catch { return false; }
    },

    CancelAgyLogin() {
      this.agyLoginCancelled = true;
      const p = this.agyLoginProcess;
      if (p) { try { killTree(p); } catch { } }
    },

    async LoginAgy() {
      const dir = path.join(platform.TempDir, 'SumIT-agy-' + guidN());
      mkdirp(dir);
      this.agyLoginCancelled = false;
      try {
        const fake = !!process.env.SUMIT_AGY;
        let exe = this.FindAgy();
        let signed = false;
        this.Send({ type: 'authCode', kind: 'gemini', state: 'wait', phase: 'interactive' });
        if (fake) {
          const p = spawnTracked(exe, [], { cwd: dir });
          this.agyLoginProcess = p;
          let exited = false;
          p.on('close', () => { exited = true; });
          const started = Date.now();
          while (!exited && !this.agyLoginCancelled && (Date.now() - started) / 1000 < this.AgyLoginTimeoutSeconds) {
            await delay(500);
            if (await this.AgyCredentialPresent()) { signed = true; break; }
          }
          if (!exited) killTree(p);
          this.agyLoginProcess = null;
        } else {
          await platform.openInTerminal(`cd "${dir}" && "${exe}"`);
          const started = Date.now();
          while (!this.agyLoginCancelled && (Date.now() - started) / 1000 < this.AgyLoginTimeoutSeconds) {
            await delay(500);
            if (await this.AgyCredentialPresent()) { signed = true; break; }
          }
        }
        if (this.agyLoginCancelled) return false;
        if (!signed) signed = await this.AgyCredentialPresent();
        if (!signed) { this.settings.agyOk = false; this.SaveSettings(); return false; }
        this.Send({ type: 'authCode', kind: 'gemini', state: 'wait', phase: 'verify' });
        let ok = false;
        exe = this.FindAgy();
        for (const mod of this.AgyModelCandidates()) {
          if (this.agyLoginCancelled) break;
          const r = await this.RunCli(exe, ['-p', 'Reply with exactly: READY', '--mode', 'plan', '--model', mod, '--print-timeout', '30s'], null, dir, 45000, true);
          if (r.code === 0 && /^\s*(?:\*\*)?READY(?:\*\*)?[.!]?\s*$/im.test(r.stdout)) {
            ok = true;
            this.settings.geminiModel = mod;
            break;
          }
        }
        this.settings.agyOk = ok;
        this.SaveSettings();
        if (!ok && !this.agyLoginCancelled) {
          this.Toast('Google לא אישר חיבור פעיל. נסה שוב או השתמש במפתח API; בדיקת החיבור מוגבלת ל-45 שניות.', true);
        }
        return ok;
      } finally {
        this.agyLoginProcess = null;
        this.Send({ type: 'authCode', kind: 'gemini', state: 'done' });
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
      }
    },

    EnsureGeminiGoogleAuth() {
      try {
        mkdirp(this.GeminiDir);
        const file = path.join(this.GeminiDir, 'settings.json');
        let root = {};
        if (fileExists(file)) {
          try { root = JSON.parse(readText(file)) || {}; } catch { return; }
        }
        if (!root.security || typeof root.security !== 'object') root.security = {};
        if (!root.security.auth || typeof root.security.auth !== 'object') root.security.auth = {};
        if ('selectedType' in root.security.auth) return;
        root.security.auth.selectedType = 'oauth-personal';
        writeText(file, JSON.stringify(root));
      } catch { }
    },

    async ConnectBrain(kind) {
      if (this.setupState.length > 0) return;
      try {
        if (kind === 'chatgpt') {
          if (!this.FindCodex()) await this.InstallCli('@openai/codex', 'installing-codex');
          this.setupState = 'login-chatgpt';
          await this.SendAiStatus();
          await this.RefreshBrains();
          if (!this.codexSignedIn) {
            await this.RunLogin(this.FindCodex(), ['login'], kind, () => false, false);
            await this.RefreshBrains();
          }
          this.settings.chatgptOk = this.codexSignedIn;
          this.SaveSettings();
          this.Toast(this.codexSignedIn ? 'ChatGPT חובר, והוא עוזר ל-Claude' : 'ההתחברות ל-ChatGPT לא הסתיימה. אפשר לנסות שוב', !this.codexSignedIn);
        } else {
          if (!this.FindAgy()) {
            this.setupState = 'installing-gemini';
            await this.SendAiStatus();
            await this.InstallAgy();
          }
          this.setupState = 'login-gemini';
          await this.SendAiStatus();
          const signedIn = await this.LoginAgy();
          this.Toast(
            signedIn ? 'Gemini חובר, והוא עוזר ל-Claude'
              : this.agyLoginCancelled ? 'ההתחברות בוטלה'
              : 'ההתחברות לא הושלמה. השלם את ההוראות בחלון Google Antigravity ונסה שוב.',
            !signedIn && !this.agyLoginCancelled
          );
        }
      } catch (ex) { this.Toast(ex.message || String(ex), true); }
      this.setupState = '';
      await this.SendAiStatus();
      this.SendSettings();
    },

    async TestBrain(kind) {
      const who = kind === 'gemini' ? 'gemini' : kind === 'chatgpt' ? 'openai' : 'claude';
      const started = Date.now();
      try {
        if (who === 'claude') {
          if (this.HasHelperKey('claude')) {
            const { Str, Unprotect } = require('../util');
            const r = await this.HelperCall('claude', Unprotect(Str(this.settings, 'claudeKey')), 'ענה במילה אחת בלבד.', [['user', 'ענה: מוכן']]);
            const ok = !!(r && !r.Error);
            this.Send({ type: 'brainTest', kind, ok, ms: Date.now() - started, text: !r ? 'לא מחובר' : Trunc(r.Text.trim(), 80), mode: 'key' });
            return;
          }
          const st = await this.AiStatus();
          const claudeReady = !!(st && st.claude && st.claude.loggedIn);
          this.Send({ type: 'brainTest', kind, ok: claudeReady, ms: Date.now() - started, text: claudeReady ? 'מחובר' : 'לא מחובר', mode: 'account' });
          return;
        }
        await this.RefreshBrains();
        if (this.HelperMode(who).length === 0) {
          this.Send({ type: 'brainTest', kind, ok: false, ms: 0, text: 'לא מחובר' });
          return;
        }
        const r = await this.HelperAsk('ענה במילה אחת בלבד.', [['user', 'ענה: מוכן']], who);
        const ok = !!(r && !r.Error);
        this.Send({ type: 'brainTest', kind, ok, ms: Date.now() - started, text: !r ? 'לא מחובר' : Trunc(r.Text.trim(), 80), mode: this.HelperMode(who) });
      } catch (ex) {
        this.Send({ type: 'brainTest', kind, ok: false, ms: Date.now() - started, text: ex.message || String(ex) });
      }
    },

    async DisconnectBrain(kind) {
      try {
        if (kind === 'claude') {
          this.settings.claudeOk = false;
          delete this.settings.claudeKey;
          this.SaveSettings();
          this.claudeLoggedIn = false;
        } else if (kind === 'chatgpt') {
          this.settings.chatgptOk = false;
          this.SaveSettings();
          if (this.FindCodex()) await Exec(this.FindCodex(), ['logout'], null, 30000, this.CliEnv());
          this.codexSignedIn = false;
        } else {
          this.settings.agyOk = false;
          this.SaveSettings();
          if (!process.env.SUMIT_AGY) await Exec('/usr/bin/security', ['delete-generic-password', '-s', 'gemini:antigravity'], null, 15000);
        }
      } catch (ex) { this.Toast(ex.message || String(ex), true); }
      await this.RefreshBrains();
      await this.SendAiStatus();
      this.SendSettings();
    },

    async RefreshBrains() {
      const codex = this.FindCodex();
      if (!codex) { this.codexSignedIn = false; return; }
      try {
        const r = await Exec(codex, ['login', 'status'], null, 20000, this.CliEnv());
        this.codexSignedIn = r.code === 0 && /Logged in/i.test(r.output);
      } catch { this.codexSignedIn = false; }
    },
  },
};
