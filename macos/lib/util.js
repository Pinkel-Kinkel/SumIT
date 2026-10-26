'use strict';
// Port of src/Util.cs plus the small async primitives the C# code got from .NET
// (Task.Delay, SemaphoreSlim, TaskCompletionSource) and process helpers that work on macOS.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- Dictionary helpers (Dictionary<string, object> -> plain objects) ----------

function Str(d, key) {
  if (!d || typeof d !== 'object') return '';
  const v = d[key];
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False'; // C# bool.ToString()
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Bool(d, key) {
  return !!d && typeof d === 'object' && d[key] === true;
}

function Int(d, key) {
  if (!d || typeof d !== 'object') return 0;
  const v = d[key];
  if (v === undefined || v === null) return 0;
  const s = String(v).trim();
  if (!/^[+-]?\d+$/.test(s)) return 0;
  const n = parseInt(s, 10);
  return n > 2147483647 || n < -2147483648 ? 0 : n;
}

function Dict(d, key) {
  if (!d || typeof d !== 'object') return null;
  const v = d[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function Arr(d, key) {
  if (!d || typeof d !== 'object') return null;
  return Array.isArray(d[key]) ? d[key] : null;
}

// ---------- Strings & names ----------

// Characters that can't be in a file name on macOS (/ and NUL), plus the Windows set so that names stay
// portable when the course folder lives in OneDrive and is opened on a Windows PC too.
const INVALID_NAME_CHARS = /[\u0000-\u001f<>:"/\\|?*]/g;

function SafeName(name) {
  name = (name || '').replace(INVALID_NAME_CHARS, '_');
  name = name.replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim();
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..*)?$/i.test(name)) name = '_' + name;
  if (name.length > 120) name = name.substring(0, 120).trim();
  return name.length > 0 ? name : 'Untitled';
}

function Trunc(s, max) {
  s = (s || '').replace(/\r/g, ' ').replace(/\n/g, ' ');
  return s.length <= max ? s : s.substring(0, max) + '...';
}

function Q(s) {
  return '"' + (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Normalises a name for loose matching ("אינפי 2 - תשפ\"ו" ~ "Infi 2").
function Loose(s) {
  s = (s || '').toLowerCase().replace(/["'`׳״()\[\]{}.,:;_\-–]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- Paths ----------

// Is `p` the same as, or inside, `root`? Case-insensitive, like the Windows original (APFS is case-insensitive by default).
function IsInside(p, root) {
  if (!p || !root) return false;
  const full = path.resolve(p).replace(/\/+$/, '') + '/';
  const r = path.resolve(root).replace(/\/+$/, '') + '/';
  return full.toLowerCase().startsWith(r.toLowerCase());
}

// Recursively lists files (like Directory.GetFiles(dir, "*", SearchOption.AllDirectories)). Returns [] when missing.
function listFiles(dir, recursive = true) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive) walk(full); }
      else if (e.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(dir, e.name)); }
  catch { return []; }
}

const fileExists = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
const dirExists = (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };
const mkdirp = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const writeText = (p, s) => { mkdirp(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); };

// Hidden helper paths in the original were written with '\\'. Use this to turn any such relative path into a native one.
const nativeRel = (rel) => (rel || '').split(/[\\/]+/).filter(Boolean).join(path.sep);

// ---------- Secrets (DPAPI -> macOS Keychain through Electron safeStorage) ----------

function Protect(secret) {
  if (!secret) return '';
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(secret).toString('base64');
    }
  } catch { }
  // Fallback when running under plain Node (e.g. offline unit tests outside Electron)
  const key = crypto.scryptSync(process.env.USER || 'sumit-mac', 'sumit-salt', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'aes:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function Unprotect(blob) {
  try {
    if (!blob) return '';
    if (blob.startsWith('aes:')) {
      const raw = Buffer.from(blob.substring(4), 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const enc = raw.subarray(28);
      const key = crypto.scryptSync(process.env.USER || 'sumit-mac', 'sumit-salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
    const { safeStorage } = require('electron');
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch { return ''; }
}

// ---------- Async primitives ----------

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// TaskCompletionSource
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  let done = false;
  return {
    promise,
    get isCompleted() { return done; },
    resolve: (v) => { if (done) return false; done = true; resolve(v); return true; },
    reject: (e) => { if (done) return false; done = true; reject(e); return true; },
  };
}

// Resolves to the value, or throws `message` after `ms`.
function withTimeout(promise, ms, message = 'timeout') {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

// SemaphoreSlim(1,1)
class Mutex {
  constructor() { this.locked = false; this.waiters = []; }
  // tryNow=true is WaitAsync(0): returns false immediately when busy.
  async wait(tryNow = false) {
    if (!this.locked) { this.locked = true; return true; }
    if (tryNow) return false;
    await new Promise(r => this.waiters.push(r));
    return true;
  }
  release() {
    const next = this.waiters.shift();
    if (next) next(); else this.locked = false;
  }
  async run(fn) { await this.wait(); try { return await fn(); } finally { this.release(); } }
}

// ---------- Processes ----------

// Every child is started in its own process group so killTree can stop the whole tree (Windows: taskkill /T /F).
function spawnTracked(exe, args = [], opts = {}) {
  const p = spawn(exe, args, {
    cwd: opts.cwd || undefined,
    env: Object.assign({}, process.env, opts.env || {}),
    stdio: opts.stdio || ['pipe', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  });
  if (p.stdout) p.stdout.setEncoding('utf8');
  if (p.stderr) p.stderr.setEncoding('utf8');
  return p;
}

function killTree(p) {
  if (!p || !p.pid) return;
  try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { } }
  setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { } }, 2500).unref();
}

// Runs a hidden process and returns { code, output } (stdout+stderr interleaved). code -1: couldn't start, -2: timed out.
// `args` is an ARRAY (the Windows version built one quoted command-line string).
function Exec(exe, args = [], cwd = null, timeoutMs = 600000, env = null, stdin = null) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, output }); } };
    let p;
    try { p = spawnTracked(exe, args, { cwd, env }); }
    catch (e) { resolve({ code: -1, output: e.message }); return; }
    const timer = setTimeout(() => { killTree(p); finish(-2); }, timeoutMs);
    p.on('error', (e) => { output += e.message; finish(-1); });
    p.stdout.on('data', d => output += d);
    p.stderr.on('data', d => output += d);
    p.on('close', (code) => finish(code === null ? -2 : code));
    if (stdin !== null && stdin !== undefined) { p.stdin.end(stdin); } else { try { p.stdin.end(); } catch { } }
  });
}

// Finds the first of `names` on PATH (platform.js extends PATH with Homebrew/npm/etc. at startup).
function FindOnPath(...names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const exe = path.join(dir.trim(), n);
      try { fs.accessSync(exe, fs.constants.X_OK); if (fs.statSync(exe).isFile()) return exe; } catch { }
    }
  }
  return null;
}

// ---------- Misc ----------

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256B64 = (buf) => crypto.createHash('sha256').update(buf).digest('base64');

function guidN() { return crypto.randomUUID().replace(/-/g, ''); }

// C# DateTime.Now.ToString(fmt) for the handful of formats the app uses.
function formatDate(d, fmt) {
  const p2 = (n) => String(n).padStart(2, '0');
  return fmt.replace('yyyy', d.getFullYear()).replace('MM', p2(d.getMonth() + 1)).replace('dd', p2(d.getDate()))
    .replace('HH', p2(d.getHours())).replace('mm', p2(d.getMinutes())).replace('ss', p2(d.getSeconds()));
}

// Zoom transcripts are WebVTT cues of "Speaker: text"; merge them into readable paragraphs
// that start a new line when the speaker changes or a minute has passed.
function VttToText(vtt, title) {
  let sb = title + '\n' + '='.repeat(Math.min(60, Math.max(10, title.length))) + '\n';
  let speaker = null;
  let paragraphStart = -1000;
  const lines = vtt.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->');
    if (arrow < 0) continue;
    const stamp = lines[i].substring(0, arrow).trim();
    let text = '';
    while (i + 1 < lines.length && lines[i + 1].trim().length > 0) text += (text.length > 0 ? ' ' : '') + lines[++i].trim();
    if (text.length === 0) continue;
    let cue = text;
    let who = null;
    const sm = /^([^:]{1,40}):\s+(.*)$/.exec(cue);
    if (sm) { who = sm[1].trim(); cue = sm[2]; }
    const seconds = stampSeconds(stamp);
    if (who !== speaker || seconds - paragraphStart >= 60) {
      sb += '\n\n[' + stamp.split('.')[0] + '] ';
      if (who !== null) sb += who + ': ';
      speaker = who;
      paragraphStart = seconds;
    } else sb += ' ';
    sb += cue;
  }
  return sb + '\n';
}

function stampSeconds(stamp) {
  let total = 0;
  for (const part of stamp.split(':')) { const v = parseFloat(part); total = total * 60 + (isNaN(v) ? 0 : v); }
  return total;
}

module.exports = {
  Str, Bool, Int, Dict, Arr, SafeName, Trunc, Q, Loose, IsInside, listFiles, listDirs, fileExists, dirExists, mkdirp,
  readText, writeText, nativeRel, Protect, Unprotect, delay, deferred, withTimeout, Mutex, spawnTracked, killTree,
  Exec, FindOnPath, sha256Hex, sha256B64, guidN, formatDate, VttToText,
};
