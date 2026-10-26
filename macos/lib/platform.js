'use strict';
// Everything that differs between the Windows build and macOS: where things live, how to open files,
// where command-line tools are installed, light/dark mode.

const fs = require('fs');
const os = require('os');
const path = require('path');
let electron = {};
try {
  const e = require('electron');
  if (e && typeof e === 'object') electron = e;
} catch { }
const { app, shell, nativeTheme } = electron;
const { Exec, FindOnPath, dirExists } = require('./util');

const Home = os.homedir();
const isPackaged = !!(app && app.isPackaged);

// Read-only resources that ship inside SumIT.app (Contents/Resources) - or the repo when running from source.
const ResourcesDir = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
const WebDir = isPackaged ? path.join(ResourcesDir, 'web') : path.join(ResourcesDir, 'src', 'web');
const EngineDir = isPackaged ? path.join(ResourcesDir, 'engine') : path.join(ResourcesDir, 'engine');
const PagesDir = path.join(__dirname, '..', 'pages');

// Writable data. On Windows these sat next to SumIT.exe; a signed .app bundle is read-only, so they go to
// ~/Library/Application Support/SumIT (Electron's userData).
const DataRoot = (app && typeof app.getPath === 'function') ? app.getPath('userData') : path.join(Home, 'Library', 'Application Support', 'SumIT');
const SettingsFile = path.join(DataRoot, 'settings.json');
const LogsDir = path.join(DataRoot, 'logs');
// Equivalent of %LOCALAPPDATA% for tools the app installs for itself (portable Node, etc.).
const LocalAppData = path.join(Home, 'Library', 'Application Support');
const ToolsDir = path.join(DataRoot, 'tools');
const Documents = (app && typeof app.getPath === 'function') ? app.getPath('documents') : path.join(Home, 'Documents');
const Downloads = (app && typeof app.getPath === 'function') ? app.getPath('downloads') : path.join(Home, 'Downloads');
const TempDir = os.tmpdir();

// A Finder-launched app gets a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin). Add the usual install locations of
// Homebrew, npm, pipx, the Claude/agy installers, etc. so claude, gemini, codex, agy, node, python3 and yt-dlp are found.
function extendPath() {
  const extra = [
    path.join(ToolsDir, 'bin'),
    path.join(ToolsDir, 'node', 'bin'),
    path.join(Home, '.local', 'bin'),
    path.join(Home, '.claude', 'local'),
    path.join(Home, '.npm-global', 'bin'),
    path.join(Home, '.antigravity', 'bin'),
    path.join(Home, '.agy', 'bin'),
    path.join(Home, 'bin'),
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/usr/local/bin', '/usr/local/sbin',
    '/Library/Frameworks/Python.framework/Versions/Current/bin',
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  // Node version managers
  for (const base of [path.join(Home, '.nvm', 'versions', 'node'), path.join(Home, '.volta', 'tools', 'image', 'node')]) {
    try { for (const v of fs.readdirSync(base).sort().reverse()) extra.push(path.join(base, v, 'bin')); } catch { }
  }
  extra.push(path.join(Home, '.volta', 'bin'));
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set();
  process.env.PATH = [...current, ...extra].filter(d => { if (seen.has(d)) return false; seen.add(d); return true; }).join(path.delimiter);
}

// Ask the login shell for its PATH too (picks up anything set in ~/.zprofile / ~/.zshrc). Best effort, 3 s max.
async function importLoginShellPath() {
  try {
    const shellExe = process.env.SHELL || '/bin/zsh';
    const r = await Exec(shellExe, ['-ilc', 'printf "__SUMIT_PATH__%s__" "$PATH"'], null, 3000);
    const m = /__SUMIT_PATH__(.*?)__/.exec(r.output);
    if (m && m[1]) {
      const seen = new Set();
      process.env.PATH = [...m[1].split(':'), ...(process.env.PATH || '').split(':')]
        .filter(d => d && !seen.has(d) && seen.add(d)).join(':');
    }
  } catch { }
}

// Explorer -> Finder
function openFolder(dir) { try { return Promise.resolve(shell && shell.openPath ? shell.openPath(dir) : '').catch(() => ''); } catch { return Promise.resolve(''); } }
function revealInFinder(file) { try { if (shell && shell.showItemInFolder) shell.showItemInFolder(file); } catch { } }
function openFile(file) { try { return Promise.resolve(shell && shell.openPath ? shell.openPath(file) : '').catch(() => ''); } catch { return Promise.resolve(''); } }
function openExternal(url) { try { return Promise.resolve(shell && shell.openExternal ? shell.openExternal(url) : undefined).catch(() => {}); } catch { return Promise.resolve(); } }

// Opens a Terminal window running `command` (used for interactive CLI sign-ins that Windows did in a console window).
function openInTerminal(command) {
  const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return Exec('/usr/bin/osascript', ['-e', `tell application "Terminal" to activate`, '-e', `tell application "Terminal" to do script "${esc}"`], null, 15000);
}

// Registry AppsUseLightTheme -> NSAppearance
// Reads the system setting itself (nativeTheme.shouldUseDarkColors follows the app's own override once themeSource is set).
function systemUsesLightTheme() {
  try {
    const { systemPreferences } = require('electron');
    return systemPreferences.getUserDefault('AppleInterfaceStyle', 'string') !== 'Dark';
  } catch { return !nativeTheme.shouldUseDarkColors; }
}

// "OneDrive - Holon Institute of Technology": on macOS the OneDrive app syncs to ~/Library/CloudStorage/OneDrive-<Org>
// (older versions: ~/OneDrive - <Org>).
function oneDriveCandidates() {
  const list = [];
  const commercial = process.env.OneDriveCommercial;
  if (commercial) list.push(commercial);
  for (const base of [path.join(Home, 'Library', 'CloudStorage'), Home]) {
    try { for (const n of fs.readdirSync(base)) if (/^OneDrive/i.test(n)) list.push(path.join(base, n)); } catch { }
  }
  return list.filter(dirExists);
}

// Volumes other than the system disk (the Windows build preferred D:\ when it existed).
function hasSecondDisk() {
  try { return fs.readdirSync('/Volumes').some(n => n !== 'Macintosh HD' && !n.startsWith('.')); } catch { return false; }
}

module.exports = {
  Home, ResourcesDir, WebDir, EngineDir, PagesDir, DataRoot, SettingsFile, LogsDir, LocalAppData, ToolsDir, Documents, Downloads,
  TempDir, extendPath, importLoginShellPath, openFolder, revealInFinder, openFile, openExternal, openInTerminal,
  systemUsesLightTheme, oneDriveCandidates, hasSecondDisk, FindOnPath,
};
