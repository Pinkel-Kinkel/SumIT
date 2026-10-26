'use strict';
// Port of src/App.cs: the main window, the six built-in browsers, settings, the UI message switch, updates,
// and the in-app site browser. Everything else lives in lib/modules/*.js and is mixed into this class, just like
// the C# `partial class HitStudent` was split across files.

const fs = require('fs');
const path = require('path');
const { app, BaseWindow, WebContentsView, session, protocol, net, dialog, clipboard, nativeTheme, ipcMain, shell, Menu } = require('electron');
const util = require('./util');
const { Str, Bool, Int, Dict, Arr, Trunc, IsInside, SafeName, delay, killTree, mkdirp, fileExists, dirExists, sha256Hex } = util;
const platform = require('./platform');
const C = require('./constants');
const { WebView } = require('./webview');

const UI_ORIGIN = 'https://app.local/';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

class Host {
  constructor(args) {
    this.args = args;
    this.demo = args.includes('--demo');
    this.selfTest = args.includes('--selftest');
    const i = args.indexOf('--selftest');
    this.selfTestOut = this.selfTest && i + 1 < args.length ? args[i + 1] : path.join(platform.DataRoot, 'selftest.json');

    this.settings = {};
    this.lastClipboard = null;
    this.siteDownloadCourse = null;
    this.siteDownloadFolder = null;
    this.shuttingDown = false;
    this.polling = false;
    this.siteScale = 1;
    this.aiRuns = new Map();      // key -> ChildProcess (Dictionary<string, Process>)
    this.helperRuns = new Set();  // HashSet<Process>
    this.claudeLoggedIn = false;

    // Updates
    this.updateVersion = this.updateZipUrl = this.updateShaUrl = this.updatePage = this.stagedUpdateDir = null;
    this.updating = false;
    this.lastUpdateCheck = 0;
    this.pendingUpdate = null;

    // Window layout: bottom -> top, like the WinForms z-order. Each panel is a list of [WebView, rect(w,h)].
    this.panels = new Map();
    this.order = [];

    for (const m of Host.modules) if (typeof m.init === 'function') m.init(this);
  }

  // ---------- Window & browsers ----------

  async start() {
    this.LoadSettings();
    nativeTheme.themeSource = ['light', 'dark'].includes(Str(this.settings, 'theme')) ? Str(this.settings, 'theme') : 'system';
    const bg = this.LightTheme ? '#F1F5FC' : '#0A1830';
    this.win = new BaseWindow({
      title: 'SumIT', width: 1240, height: 820, minWidth: 820, minHeight: 620, center: true, backgroundColor: bg, show: !this.selfTest,
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 }, tabbingIdentifier: 'sumit',
    });
    this.win.on('resize', () => this.layout());
    this.win.on('focus', () => this.CheckClipboard(false));
    this.win.on('close', () => this.onClosing());
    nativeTheme.on('updated', () => this.ApplyTitleBarTheme());

    this.uiSession = session.fromPartition('persist:sumit-ui');
    this.browserSession = session.fromPartition('persist:sumit');   // was the shared WebView2 "browser-data" profile
    this.scraperSession = session.fromPartition('persist:sumit-scraper');
    this.scraperSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
      // Block non-essential visual/media assets, analytics, fonts, and ads in the scraper view
      const blockedTypes = ['stylesheet', 'font', 'media', 'image', 'imageset', 'ping', 'beacon'];
      if (blockedTypes.includes(details.resourceType) || /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|adservice|adsystem/i.test(details.url)) {
        cb({ cancel: true });
      } else {
        cb({ cancel: false });
      }
    });
    this.registerAppLocal(this.uiSession);
    this.browserSession.on('will-download', (e, item, wc) => this.OnSiteDownload(item, wc));
    this.browserSession.setPermissionRequestHandler((wc, permission, cb) => cb(['clipboard-sanitized-write', 'fullscreen', 'notifications', 'media'].includes(permission)));

    const pre = (n) => path.join(__dirname, '..', n);
    this.zoom = new WebView('zoom', { session: this.browserSession });
    this.moodle = new WebView('moodle', { session: this.browserSession });
    this.site = new WebView('site', { session: this.browserSession, preload: pre('preload-site.js') });
    this.cs24View = new WebView('cs24', { session: this.scraperSession });    // hidden: walks a course's CS24 folder
    this.printView = new WebView('print', { session: this.browserSession });  // hidden: prints a lecture summary to PDF
    this.ui = new WebView('ui', { session: this.uiSession, preload: pre('preload-ui.js'), background: bg });

    const fill = (w, h) => ({ x: 0, y: 0, width: w, height: h });
    this.addPanel('site', [[this.site, () => this.siteBounds || { x: 0, y: 0, width: 10, height: 10 }]], false);
    this.addPanel('moodle', this.loginPanel(this.moodle, 'התחבר עם שם המשתמש והסיסמה של HIT. זה קורה פעם אחת בלבד.', () => { this.moodleCancelled = true; this.bringToFront('ui'); }));
    this.addPanel('zoom', this.loginPanel(this.zoom, 'התחבר ל-Zoom עם המשתמש של HIT. זה קורה פעם אחת, וההורדה תמשיך לבד.', () => { if (this.working) this.zoomCancelled = true; this.bringToFront('ui'); }));
    this.addPanel('cs24', [[this.cs24View, fill]]);
    this.addPanel('print', [[this.printView, fill]]);
    this.addPanel('ui', [[this.ui, fill]]);
    this.bringToFront('ui');
    this.layout();
    this.buildMenu();
    await this.InitAsync();
  }

  // A browser with the blue bar on top ("sign in with your HIT user" + "back to the app"), as in the WinForms LoginPanel.
  loginPanel(view, hint, back) {
    const bar = new WebView(view.name + '-bar', { session: this.uiSession, preload: path.join(__dirname, '..', 'preload-bar.js'), background: '#1F64D8' });
    bar.wc.loadFile(path.join(platform.PagesDir, 'loginbar.html'), { query: { hint } });
    this.barHandlers = this.barHandlers || new Map();
    this.barHandlers.set(bar.wc.id, back);
    if (!this._barIpc) {
      this._barIpc = true;
      ipcMain.on('sumit-loginbar-back', (e) => { const h = this.barHandlers.get(e.sender.id); if (h) h(); });
    }
    return [[bar, (w) => ({ x: 0, y: 0, width: w, height: 60 })], [view, (w, h) => ({ x: 0, y: 60, width: w, height: Math.max(0, h - 60) })]];
  }

  addPanel(name, items, visible = true) {
    this.panels.set(name, { items, visible });
    if (!this.order.includes(name)) this.order.unshift(name);
    for (const [v] of items) { this.win.contentView.addChildView(v.view); v.view.setVisible(visible); }
    this.restack();
  }

  removePanel(name) {
    const p = this.panels.get(name);
    if (!p) return;
    for (const [v] of p.items) { try { this.win.contentView.removeChildView(v.view); } catch { } }
    this.panels.delete(name);
    this.order = this.order.filter(n => n !== name);
  }

  // Control.BringToFront()
  bringToFront(name) {
    if (!this.panels.has(name)) return;
    this.order = this.order.filter(n => n !== name).concat(name);
    this.restack();
  }

  // Panel.Visible
  setPanelVisible(name, visible) {
    const p = this.panels.get(name);
    if (!p) return;
    p.visible = visible;
    for (const [v] of p.items) v.view.setVisible(visible);
    this.layout();
  }
  isPanelVisible(name) { const p = this.panels.get(name); return !!p && p.visible; }
  frontPanel() { return this.order[this.order.length - 1]; }

  restack() {
    for (const name of this.order) for (const [v] of this.panels.get(name).items) this.win.contentView.addChildView(v.view);
    this.layout();
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    for (const name of this.order) {
      const p = this.panels.get(name);
      for (const [v, rect] of p.items) v.view.setBounds(rect(width, height));
    }
  }

  clientWidth() { return this.win.getContentBounds().width; }

  // The app page only ever shows files from the "web" folder: https://app.local/<file> (SetVirtualHostNameToFolderMapping).
  registerAppLocal(ses) {
    ses.protocol.handle('https', async (req) => {
      const u = new URL(req.url);
      if (u.hostname !== 'app.local') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      let rel;
      try { rel = decodeURIComponent(u.pathname); } catch { return new Response('bad request', { status: 400 }); }
      const file = path.resolve(platform.WebDir, '.' + rel);
      if (!IsInside(file, platform.WebDir) || !fileExists(file)) return new Response('not found', { status: 404 });
      return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    });
  }

  buildMenu() {
    const template = [
      { role: 'appMenu' },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ label: 'Back to SumIT', accelerator: 'CmdOrCtrl+0', click: () => { this.bringToFront('ui'); } }, { role: 'togglefullscreen' }].concat(this.demo ? [{ label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => this.ui.wc.openDevTools({ mode: 'detach' }) }] : []) },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  async InitAsync() {
    try {
      for (const v of [this.printView, this.cs24View]) { v.muted = true; v.setDevTools(false); }
      this.printView.wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.cs24View.wc.setWindowOpenHandler((d) => this.OpenSitePopup(this.cs24View, d));
    } catch (ex) {
      if (!this.selfTest) dialog.showMessageBoxSync({ message: "Couldn't start the built-in browser.\n\n" + ex.message, title: 'SumIT' });
      app.quit();
      return;
    }

    const u = this.ui;
    u.setDevTools(this.demo);
    u.wc.on('context-menu', (e) => e.preventDefault && e.preventDefault());
    u.wc.setVisualZoomLevelLimits(1, 1).catch(() => { });
    u.wc.on('before-input-event', (e, input) => {
      // AreBrowserAcceleratorKeysEnabled = false / IsZoomControlEnabled = false
      if (input.meta && ['r', '=', '+', '-', '0'].includes(input.key.toLowerCase())) e.preventDefault();
    });
    u.wc.on('will-navigate', (e, url) => { if (!url.toLowerCase().startsWith(UI_ORIGIN)) { e.preventDefault(); this.OpenExternal(url); } });
    u.wc.on('will-redirect', (e, url) => { if (!url.toLowerCase().startsWith(UI_ORIGIN)) { e.preventDefault(); this.OpenExternal(url); } });
    u.wc.setWindowOpenHandler(({ url }) => { this.OpenExternal(url); return { action: 'deny' }; });
    ipcMain.on('sumit-ui-message', (e, json) => this.OnUiMessage(e, json));
    ipcMain.on('sumit-site-message', (e, json) => { if (typeof this.OnSummarySelectionMessage === 'function') this.OnSummarySelectionMessage(json); });
    u.wc.on('dom-ready', () => u.wc.insertCSS('h1,h2,h3,.brand b{font-family:-apple-system,"SF Pro Display",system-ui,sans-serif}body{font-family:-apple-system,"SF Pro Text",system-ui,sans-serif}').catch(() => { }));
    let demoArgs = '';
    for (const a of process.argv) if (a.startsWith('--demo-')) demoArgs += '&' + encodeURIComponent(a.substring(7).split('=')[0]) + '=' + encodeURIComponent(a.includes('=') ? a.split('=')[1] : '1');
    u.navigate(UI_ORIGIN + 'ui.html' + (this.demo ? '?demo=1' + demoArgs : ''));

    for (const view of [this.zoom, this.moodle]) {
      view.muted = true;
      view.setDevTools(false);
      view.wc.setWindowOpenHandler((d) => this.OpenSitePopup(view, d));
    }
    if (typeof this.OnZoomResponse === 'function') this.zoom.watchResponses('/play/info', (url, body) => this.OnZoomResponse(url, body));

    const sc = this.site;
    sc.setDevTools(false);
    sc.wc.setWindowOpenHandler((d) => this.OpenSitePopup(sc, d));
    const onNav = () => {
      this.Send({ type: 'siteNav', url: sc.source, canBack: sc.canGoBack, canForward: sc.canGoForward });
      // A Zoom recording page: the page offers to download it into the lecture the student is working on.
      if (this.IsZoomUrl(sc.source)) this.Send({ type: 'zoomRecording', url: sc.source });
    };
    sc.wc.on('did-navigate', onNav);
    sc.wc.on('did-navigate-in-page', onNav);
    sc.wc.on('did-start-loading', () => this.Send({ type: 'siteLoading', loading: true }));
    sc.wc.on('did-stop-loading', () => this.Send({ type: 'siteLoading', loading: false }));

    this.CleanUpOldFiles();
    this.InstallSkill();
    if (this.demo) return;
    if (this.selfTest) { await this.RunSelfTest(); return; }
    this.statusTimer = setInterval(async () => {
      await this.PollStatus(false);
      // The app often stays open for days: look for a new version every few hours, not only at start.
      if (Date.now() - this.lastUpdateCheck > 4 * 3600 * 1000) this.CheckForUpdate();
    }, 45000);
    this.CheckForUpdate();
  }

  onClosing() {
    this.shuttingDown = true;
    if (this.statusTimer) clearInterval(this.statusTimer);
    try { if (this.CancelAgyLogin) this.CancelAgyLogin(); } catch { }
    for (const p of this.aiRuns.values()) killTree(p);
    for (const p of this.helperRuns) killTree(p);
  }

  // ---------- Settings ----------

  LoadSettings() {
    try {
      if (fileExists(platform.SettingsFile))
        Object.assign(this.settings, JSON.parse(util.readText(platform.SettingsFile)));
    } catch { }
    const docs = platform.Documents;
    if (Str(this.settings, 'studyRoot').length === 0) this.settings.studyRoot = this.DefaultStudyRoot(platform.hasSecondDisk(), docs);
    if (Str(this.settings, 'recordingsDir').length === 0)
      this.settings.recordingsDir = path.join(path.dirname(Str(this.settings, 'studyRoot').replace(/\/+$/, '')) || docs, 'הקלטות');
    if (Str(this.settings, 'aiProvider').length === 0) this.settings.aiProvider = 'claude';
    for (const opt of ['autoSync', 'autoRecordings', 'autoUpdate', 'autoFallback', 'pdfDark'])
      if (!(opt in this.settings)) this.settings[opt] = opt === 'autoFallback';   // pdfDark: off
    this.settings.autoRecordings = false; this.settings.autoUpdate = false; this.settings.autoSync = false;
  }

  // "HIT/קורסים" inside the student's HIT OneDrive when there is one, so the courses are backed up and follow them; otherwise in Documents.
  DefaultStudyRoot(hasD, docs) {
    const od = this.HitOneDrive();
    return od.length > 0 ? path.join(od, 'HIT', 'קורסים') : path.join(docs, 'HIT', 'קורסים');
  }

  // The OneDrive of HIT on this Mac (~/Library/CloudStorage/OneDrive-HolonInstituteofTechnology), or "" when it is not set up.
  HitOneDrive() {
    try {
      for (const od of platform.oneDriveCandidates())
        if (/holon|\bHIT\b|institute ?of ?technology|הולון/i.test(path.basename(od.replace(/\/+$/, '')))) return od;
    } catch { }
    return '';
  }

  DefaultStudyRootForTest() { return this.DefaultStudyRoot(true, platform.Documents); }

  // The courses live in "<HIT>/קורסים"; the timetable and general downloads sit next to them, in "<HIT>".
  get AppRoot() { const r = this.StudyRoot.replace(/\/+$/, ''); return path.basename(r) === 'קורסים' ? path.dirname(r) : r; }

  Option(name) { return Bool(this.settings, name); }

  SystemUsesLightTheme() { return platform.systemUsesLightTheme(); }

  // "system" (default), "light" or "dark", chosen in the app.
  get LightTheme() {
    const t = Str(this.settings, 'theme');
    return t === 'light' || (t !== 'dark' && this.SystemUsesLightTheme());
  }

  // DwmSetWindowAttribute -> NSAppearance: the macOS title bar follows the app's light/dark choice.
  ApplyTitleBarTheme() {
    const t = Str(this.settings, 'theme');
    const src = t === 'light' || t === 'dark' ? t : 'system';
    if (nativeTheme.themeSource !== src) nativeTheme.themeSource = src;
    const bg = this.LightTheme ? '#F1F5FC' : '#0A1830';
    try { this.win.setBackgroundColor(bg); this.ui.view.setBackgroundColor(bg); } catch { }
  }

  SaveSettings() {
    try { util.writeText(platform.SettingsFile, JSON.stringify(this.settings)); } catch { }
  }

  get StudyRoot() { return Str(this.settings, 'studyRoot'); }
  get RecordingsDir() { return Str(this.settings, 'recordingsDir'); }
  get NotabilityDir() { return Str(this.settings, 'notabilityDir'); }
  get GeminiEnabled() { return C.GeminiEnabled; }
  // Claude when the student has it; otherwise ChatGPT / Gemini (through their accounts), which then write the summaries too.
  get Provider() { return this.claudeLoggedIn ? 'claude' : this.ChatGptAccountReady() ? 'openai' : this.GeminiAccountReady() ? 'gemini' : 'claude'; }

  // The student's own to-do list: a title, an optional course and date, done or not. Only these fields are kept.
  CleanTasks(raw) {
    const list = [];
    if (!Array.isArray(raw)) return list;
    for (const o of raw.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 300)) {
      const title = Trunc(Str(o, 'title').trim(), 200);
      if (title.length === 0) continue;
      let due = Str(o, 'due');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) due = '';
      list.push({ id: Trunc(Str(o, 'id'), 40), title, course: Trunc(Str(o, 'course'), 120), due, done: Bool(o, 'done') });
    }
    return list;
  }

  SendSettings() {
    const hitOd = this.HitOneDrive();
    this.Send({
      snapSeen: Bool(this.settings, 'snapSeen'), hitOneDrive: hitOd,
      studyInHitOneDrive: hitOd.length > 0 && this.StudyRoot.toLowerCase().startsWith(hitOd.replace(/\/+$/, '').toLowerCase() + '/'),
      tasks: Array.isArray(this.settings.tasks) ? this.settings.tasks : [],
      type: 'settings', studyRoot: this.StudyRoot, recordingsDir: this.RecordingsDir, notabilityDir: this.NotabilityDir,
      aiProvider: this.Provider, hasGeminiKey: Str(this.settings, 'geminiKey').length > 0, hasOpenAiKey: Str(this.settings, 'openaiKey').length > 0,
      helperPref: Str(this.settings, 'helperPref').length > 0 ? Str(this.settings, 'helperPref') : 'auto', displayName: Str(this.settings, 'displayName'), bio: Str(this.settings, 'bio'),
      onboarded: Bool(this.settings, 'onboarded'), userName: Str(this.settings, 'userName'), version: C.Version,
      autoSync: this.Option('autoSync'), autoRecordings: this.Option('autoRecordings'), autoUpdate: this.Option('autoUpdate'), autoFallback: this.Option('autoFallback'), pdfDark: this.Option('pdfDark'),
      profileImage: this.ProfileImage(),
      theme: Str(this.settings, 'theme').length > 0 ? Str(this.settings, 'theme') : 'system', systemLight: this.SystemUsesLightTheme(),
      discordUrl: Str(this.settings, 'discordUrl'),
      platform: 'mac',
    });
  }

  // ---------- UI messages ----------

  Send(message) {
    if (this.shuttingDown || !this.ui || this.ui.wc.isDestroyed()) return;
    try { this.ui.wc.send('sumit-host-message', JSON.parse(JSON.stringify(message === undefined ? null : message))); } catch { }
  }

  Toast(text, error) { this.Send({ type: 'toast', text, error: !!error }); }

  OnUiMessage(e, raw) {
    if (!this.ui || e.sender.id !== this.ui.wc.id) return;
    const src = (e.senderFrame && e.senderFrame.url) || '';
    if (!src.toLowerCase().startsWith(UI_ORIGIN)) return;
    let m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (this.demo) return;
    Promise.resolve().then(() => this.HandleUiMessage(m)).catch(ex => this.Toast(ex && ex.message ? ex.message : String(ex), true));
  }

  async HandleUiMessage(m) {
    const type = Str(m, 'type');
    const course = Str(m, 'course');
    switch (type) {
      case 'ready':
        this.SendSettings();
        for (const j of this.jobs || []) this.SendJob(j);
        this.CheckClipboard(false);
        this.SendTimetable(); this.SendAcademic();
        if (this.pendingUpdate) this.Send(this.pendingUpdate); else if (!this.updating) this.CheckForUpdate();
        this.PollStatus(true);
        break;
      case 'finishOnboarding':
        this.settings.onboarded = true;
        this.SaveSettings();
        this.SendSettings();
        break;
      case 'checkStatus': this.PollStatus(true); break;
      case 'setOption': {
        const opt = Str(m, 'name');
        if (['autoSync', 'autoRecordings', 'autoUpdate', 'autoFallback', 'pdfDark'].includes(opt)) { this.settings[opt] = Bool(m, 'value'); this.SaveSettings(); this.SendSettings(); }
        if (opt === 'helperPref') { const pv = Str(m, 'value'); this.settings[opt] = ['gemini', 'openai', 'claude'].includes(pv) ? pv : 'auto'; this.SaveSettings(); this.SendSettings(); }
        if (opt === 'theme') {
          const t = Str(m, 'value');
          this.settings.theme = t === 'light' || t === 'dark' ? t : 'system';
          this.SaveSettings();
          this.ApplyTitleBarTheme();
          this.SendSettings();
        }
        if (opt === 'discordUrl') {
          this.settings.discordUrl = Str(m, 'value').trim();
          this.SaveSettings();
          this.SendSettings();
        }
        break;
      }
      case 'installUpdate': this.InstallUpdate(); break;
      case 'checkUpdate': this.Send({ type: 'updateCheck', text: 'בודק...' }); this.CheckForUpdate(true); break;
      case 'restartForUpdate': this.RestartIntoUpdate(); break;
      case 'addRecording': {
        const rec = Str(m, 'url').trim();
        if (!this.IsZoomUrl(rec)) { this.Toast('זה לא קישור להקלטת Zoom', true); return; }
        if (!this.QueueRecording(course, Int(m, 'num'), rec, true, Str(m, 'name'))) this.Toast('ההקלטה הזו כבר בהורדה או הורדה', false);
        break;
      }
      case 'addLectureRecording': {
        const lrec = Str(m, 'url').trim();
        if (!this.IsZoomUrl(lrec)) { this.Toast('זה לא קישור להקלטת Zoom', true); return; }
        this.QueueLectureRecording(course, Int(m, 'num'), lrec, Str(m, 'name'));
        break;
      }
      case 'addRecordingFile': await this.AddRecordingFromPc(course, Int(m, 'num'), Str(m, 'name')); break;
      case 'homework': this.Homework(course, Int(m, 'num'), Str(m, 'title')); break;
      case 'learnCourse': this.LearnCourse(course, Arr(m, 'sections')); break;

      // AI
      case 'setProvider':
        this.settings.aiProvider = Str(m, 'provider') === 'gemini' ? 'gemini' : 'claude';
        this.SaveSettings();
        this.SendSettings();
        this.PollStatus(true);
        break;
      case 'setupClaude': this.SetupClaude(); break;
      case 'setupGemini': this.SetupGemini(); break;
      case 'loginGemini': this.ConnectBrain('gemini'); break;
      case 'geminiCode': this.GeminiCode(Str(m, 'code')); break;
      case 'setupDone': {
        const sm = this.LoadMeta(course);
        sm.setupDone = true;
        this.SaveMeta(course, sm);
        break;
      }
      case 'cancelGeminiLogin': this.CancelGeminiLogin(); this.CancelAgyLogin(); break;
      case 'setGeminiKey': this.SetHelperKey('gemini', Str(m, 'key')); break;
      case 'setGeminiModel': {
        const mod = Str(m, 'model').trim();
        if (mod) {
          this.settings.geminiModel = mod;
          this.SaveSettings();
          this.SendSettings();
        }
        break;
      }
      case 'setHelperKey': this.SetHelperKey(Str(m, 'provider'), Str(m, 'key')); break;
      case 'removeHelperKey': this.RemoveHelperKey(Str(m, 'provider')); break;
      case 'testBrain': this.TestBrain(Str(m, 'kind')); break;
      case 'connectBrain': this.ConnectBrain(Str(m, 'kind')); break;
      case 'disconnectBrain': this.DisconnectBrain(Str(m, 'kind')); break;
      case 'chatCheck': this.ChatCheck(course, this.ChatScope(m)); break;
      case 'secondOpinion': this.SecondOpinionAndPdf(course, Int(m, 'num')); break;
      case 'downloadMoodle': this.DownloadFromMoodle(course, Int(m, 'id'), Str(m, 'what')); break;
      case 'setProfile':
        this.settings.displayName = Trunc(Str(m, 'name').trim(), 40);
        this.settings.bio = Trunc(Str(m, 'bio').trim(), 80);
        this.SaveSettings(); this.SendSettings();
        break;
      case 'saveTasks':
        this.settings.tasks = this.CleanTasks(Arr(m, 'tasks'));
        this.SaveSettings(); this.SendSettings();
        break;
      case 'openGeminiKeyPage': this.OpenExternal('https://aistudio.google.com/apikey'); break;
      case 'openOpenAiKeyPage': this.OpenExternal('https://platform.openai.com/api-keys'); break;

      // Moodle
      case 'connectMoodle': this.ConnectMoodle(); break;
      case 'loadCourses': this.LoadCourses(); break;
      case 'loadHome': this.LoadHome(); break;
      case 'openCourse': this.OpenCourse(Int(m, 'id'), course); break;
      case 'setLecturer': {
        const meta = this.LoadMeta(course);
        meta.lecturer = Str(m, 'name').trim();
        this.SaveMeta(course, meta);
        break;
      }
      case 'syncSection': this.SyncSection(course, Dict(m, 'section')); break;
      case 'syncCourse': this.SyncCourse(course, Arr(m, 'sections')); break;
      case 'saveLectureCalendar': this.SaveLectureCalendar(course, m); break;
      case 'saveLecture': this.SaveLecture(course, m); break;
      case 'addFiles': await this.AddFiles(course, Str(m, 'folder'), Str(m, 'kind')); break;

      // AI tasks
      case 'getNewMaterial': this.GetNewMaterial(course, Arr(m, 'sections'), Arr(m, 'nums')); break;
      case 'lecturePdf': this.StartLectureSummary(m); break;
      case 'summarize': this.Summarize(course, Int(m, 'num'), Str(m, 'title')); break;
      case 'analyzeCourse': this.AnalyzeCourse(course); break;
      case 'examPrep': this.ExamPrep(course); break;
      case 'chat': this.Chat(course, Str(m, 'text'), this.ChatScope(m)); break;
      case 'chatReset': {
        const meta2 = this.LoadMeta(course);
        const sessions = Dict(meta2, 'lectureChatSessions') || {};
        delete sessions[this.ChatScope(m)];
        meta2.lectureChatSessions = sessions;
        const histories = Dict(meta2, 'lectureChatHistories') || {};
        delete histories[this.ChatScope(m)];
        meta2.lectureChatHistories = histories;
        this.SaveMeta(course, meta2);
        break;
      }
      case 'cancelAi': {
        const run = this.aiRuns.get(Str(m, 'key'));
        if (run) killTree(run);
        break;
      }

      // Recordings
      case 'paste': this.CheckClipboard(true); break;
      case 'add': {
        const url = Str(m, 'url').trim();
        if (url.length === 0) return;
        this.AddJob(this.NewJob({ Url: url, Name: Str(m, 'name').trim(), Transcript: Bool(m, 'transcript') }));
        break;
      }
      case 'retry': this.RetryJob(this.FindJob(m)); break;
      case 'remove': {
        const rj = this.FindJob(m);
        if (rj && (rj.State === 'done' || rj.State === 'failed')) this.jobs.splice(this.jobs.indexOf(rj), 1);
        break;
      }
      case 'openFile': {
        const oj = this.FindJob(m);
        const jp = !oj ? null : (Str(m, 'which') === 'transcript' ? oj.TranscriptPath : oj.VideoPath);
        if (jp) this.OpenLocal(jp);
        break;
      }
      case 'showFile': {
        const sj = this.FindJob(m);
        const sp = !sj ? null : (sj.VideoPath || sj.TranscriptPath);
        if (sp && fileExists(sp)) platform.revealInFinder(sp);
        break;
      }

      // Folders
      case 'chooseFolder': await this.ChooseFolder(Str(m, 'which')); break;
      case 'snapDone': this.settings.snapSeen = true; this.SaveSettings(); break;
      case 'useHitOneDrive': {
        const hitOd = this.HitOneDrive();
        if (hitOd.length === 0) { this.Toast('לא מצאתי OneDrive של HIT במחשב', true); break; }
        this.settings.studyRoot = path.join(hitOd, 'HIT', 'קורסים');
        this.settings.recordingsDir = path.join(hitOd, 'HIT', 'הקלטות');
        this.SaveSettings(); this.SendSettings();
        break;
      }
      case 'openFolder': {
        const which = Str(m, 'which');
        const folder = which === 'study' ? this.StudyRoot : which === 'notability' ? this.NotabilityDir : this.RecordingsDir;
        if (folder.length === 0) return;
        mkdirp(folder);
        platform.openFolder(folder);
        break;
      }
      case 'openPath': this.OpenLocal(Str(m, 'path')); break;
      case 'openLink': this.OpenExternal(Str(m, 'url')); break;

      // Notability
      case 'linkNotability': this.LinkNotability(course, Str(m, 'folder')); break;
      case 'openNotability': this.OpenNotability(); break;
      case 'importTimetable': this.ImportTimetable(null, Bool(m, 'fromFolder')); break;
      case 'deleteTimetable': this.DeleteTimetable(); break;
      case 'skipExams': this.SkipExams(course); break;
      case 'viewFile': this.ShowFile(m); break;
      case 'selectSummary': this.SelectSummary(m); break;
      case 'summaryChat': this.AskSummary(m); break;
      case 'shareSummary': this.ShareSummary(m); break;
      case 'pickProfileImage': await this.SetProfileImage(false); break;
      case 'clearProfileImage': await this.SetProfileImage(true); break;
      case 'setCourseBackground': this.SetCourseBackground(course, Str(m, 'mode'), Str(m, 'colors')); break;
      case 'pasteTimetable': {
        const img = clipboard.readImage();
        if (img.isEmpty()) { this.Toast('העתק תמונה של מערכת השעות ואז הדבק כאן', true); break; }
        const clipboardPath = path.join(platform.TempDir, 'timetable-' + util.guidN() + '.png');
        fs.writeFileSync(clipboardPath, img.toPNG());
        this.ImportTimetable([clipboardPath]);
        break;
      }
      case 'cs24Sync': this.Cs24Sync(course); break;
      case 'setupRun': this.SetupRun(course, Arr(m, 'sections'), Bool(m, 'cs24')); break;
      case 'prepareCourses': this.PrepareCourses(Arr(m, 'courses')); break;

      // Sites inside the app
      case 'showSite': this.ShowSite(m); break;
      case 'placeSite': this.PlaceSite(m); break;
      case 'hideSite': this.setPanelVisible('site', false); if (this.popupView) this.setPanelVisible('popup', false); break;
      case 'siteNavigate': {
        const go = Str(m, 'url');
        if (this.IsMoodleUrl(go) && this.site && this.site.source !== go) this.site.navigate(go);
        break;
      }
      case 'siteAction': this.SiteAction(Str(m, 'action')); break;
      case 'setDownloadTarget':
        this.siteDownloadCourse = course.length > 0 ? course : null;
        this.siteDownloadFolder = Str(m, 'folder');
        break;
    }
  }

  CheckClipboard(force) {
    try {
      const t = clipboard.readText().trim();
      if (!t) return;
      if (t.toLowerCase().indexOf('zoom.us/rec/') < 0 || t.length > 2000) return;
      if (!force && t === this.lastClipboard) return;
      this.lastClipboard = t;
      this.Send({ type: 'clipboard', url: t, force });
    } catch { }
  }

  // ---------- Native dialogs (WinForms FolderBrowserDialog / OpenFileDialog / MessageBox) ----------

  async pickFolder(title, defaultPath) {
    const r = await dialog.showOpenDialog(this.win, { title, message: title, defaultPath: dirExists(defaultPath) ? defaultPath : undefined, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }

  // filters: [{ name, extensions: ['pdf', ...] }]
  async pickFiles(title, filters, multi = true, defaultPath) {
    const props = ['openFile'];
    if (multi) props.push('multiSelections');
    const r = await dialog.showOpenDialog(this.win, { title, message: title, filters, defaultPath, properties: props });
    return r.canceled ? [] : r.filePaths;
  }

  async savePath(title, defaultPath, filters) {
    const r = await dialog.showSaveDialog(this.win, { title, defaultPath, filters });
    return r.canceled ? null : r.filePath;
  }

  // Returns true for "Yes" (MessageBoxButtons.YesNo) / always true for an OK box.
  async ask(text, title = 'SumIT', yesNo = true) {
    const r = await dialog.showMessageBox(this.win, { type: yesNo ? 'question' : 'info', message: title, detail: text, buttons: yesNo ? ['כן', 'לא'] : ['אישור'], defaultId: 0, cancelId: yesNo ? 1 : 0 });
    return r.response === 0;
  }

  async ChooseFolder(which) {
    const key = which === 'study' ? 'studyRoot' : which === 'notability' ? 'notabilityDir' : 'recordingsDir';
    const title = which === 'study' ? 'בחר את תיקיית הקורסים' : which === 'notability' ? 'בחר את תיקיית הגיבוי של Notability' : 'בחר איפה לשמור הקלטות';
    const chosen = await this.pickFolder(title, Str(this.settings, key));
    if (!chosen) return;
    this.settings[key] = chosen;
    this.SaveSettings();
    this.SendSettings();
    if (which === 'notability') this.SendNotabilityFolders();
  }

  OpenLocal(p) {
    // Only things inside the app's own folders. Anything that could run (an app from Moodle, a script)
    // is shown in Finder instead of being opened.
    if (!p) return;
    const full = path.resolve(p);
    const inside = IsInside(full, this.AppRoot) || IsInside(full, this.StudyRoot) || IsInside(full, this.RecordingsDir) || (this.NotabilityDir.length > 0 && IsInside(full, this.NotabilityDir));
    if (!inside) return;
    if (dirExists(full)) platform.openFolder(full);
    else if (fileExists(full)) {
      if (C.SafeToOpen.has(path.extname(full).toLowerCase())) platform.openFile(full);
      else platform.revealInFinder(full);
    }
  }

  OpenExternal(url) {
    let u;
    try { u = new URL(url); } catch { return; }
    if (u.protocol === 'https:' || u.protocol === 'http:') platform.openExternal(u.href);
  }

  // ---------- Status ----------

  async PollStatus(full) {
    if (this.polling) return;
    this.polling = true;
    try {
      const ai = await this.AiStatus();
      this.Send({ type: 'aiStatus', status: ai });
      const ms = await this.MoodleHeartbeat();
      this.Send({ type: 'moodle', state: ms, message: '' });
      if (full && ms === 'ready') this.LoadHome();
      this.ImportAllNotability();
      this.RecoverSummaries();
      // Every few hours: anything new on Moodle in the courses that are set up? (Not while a course is downloading.)
      if (ms === 'ready' && this.Option('autoSync') && this.syncingCourses.size === 0 && this.progressRange.size === 0) this.BackgroundNewMaterialCheck();
    } catch { }
    finally { this.polling = false; }
  }

  // ---------- Updates ----------
  // Each GitHub release carries SumIT.zip (Windows). On macOS the app looks for a SumIT-<version>-<arch>.dmg (or -mac.zip) asset;
  // replacing a running, signed .app in place isn't done - the release page / DMG is opened for the student instead.

  async CheckForUpdate(manual = false) {
    this.lastUpdateCheck = Date.now();
    if (this.stagedUpdateDir || this.updating) return;
    try {
      const r = await net.fetch('https://api.github.com/repos/' + C.Repo + '/releases/latest', { headers: { 'User-Agent': 'SumIT/' + C.Version } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rel = await r.json();
      const tag = Str(rel, 'tag_name').replace(/^v+/, '');
      if (!this.newerVersion(tag, C.Version)) {
        this.pendingUpdate = null;
        this.Send({ type: 'updateCheck', text: 'יש לך את הגרסה האחרונה (' + C.Version + '). נבדק ' + util.formatDate(new Date(), 'HH:mm') });
        return;
      }
      this.updateVersion = tag;
      this.updatePage = Str(rel, 'html_url');
      this.updateZipUrl = this.updateShaUrl = null;
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      for (const a of Array.isArray(rel.assets) ? rel.assets : []) {
        const url = Str(a, 'browser_download_url');
        if (!C.RepoNames.some(rn => url.toLowerCase().startsWith(('https://github.com/' + rn + '/releases/download/').toLowerCase()))) continue;
        const name = Str(a, 'name');
        if (/\.dmg$/i.test(name) && (name.includes(arch) || name.includes('universal'))) this.updateZipUrl = url;
      }
      // canAuto=false: the UI shows "download" and opens the DMG / release page.
      this.pendingUpdate = { type: 'update', version: tag, url: this.updatePage, canAuto: false, notes: Trunc(Str(rel, 'body'), 600) };
      this.Send(this.pendingUpdate);
    } catch (ex) { this.Send({ type: 'updateCheck', text: 'לא הצלחתי לבדוק עדכונים: ' + ex.message }); }
  }

  newerVersion(latest, mine) {
    const p = (v) => (/^\d+(\.\d+){1,3}$/.test(v) ? v.split('.').map(Number) : null);
    const a = p(latest), b = p(mine);
    if (!a || !b) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; }
    return false;
  }

  InstallUpdate() { this.OpenExternal(this.updateZipUrl || this.updatePage || ('https://github.com/' + C.Repo + '/releases/latest')); }
  RestartIntoUpdate() { app.relaunch(); app.quit(); }
  CleanUpOldFiles() { }

  // ---------- Sites inside the app ----------

  ShowSite(m) {
    const key = Str(m, 'site');
    const url = C.Sites[key];
    if (!url) return;
    this.PlaceSite(m);
    if (key !== 'portal') this.CloseSitePopup();
    const current = this.site.source || '';
    const host = new URL(url).host;
    const deep = Str(m, 'url');
    if (key === 'moodle' && this.IsMoodleUrl(deep)) this.site.navigate(deep);   // e.g. a deadline from the home page
    else if (current.toLowerCase().indexOf(host.toLowerCase()) < 0) this.site.navigate(url);
    this.setPanelVisible('site', true);
    this.bringToFront('site');
    if (this.popupView && this.panels.has('popup')) { this.setPanelVisible('popup', true); this.bringToFront('popup'); }
  }

  PlaceSite(m) {
    // The page reports the box (in CSS pixels) where the site should appear; scale it to window points.
    const num = (k) => { const v = Number(m[k]); return isFinite(v) ? v : 0; };
    const vw = num('vw');
    if (vw > 0) this.siteScale = this.clientWidth() / vw;
    const x = Math.round(num('x') * this.siteScale);
    const y = Math.round(num('y') * this.siteScale);
    let w = Math.round(num('w') * this.siteScale);
    const h = Math.round(num('h') * this.siteScale);
    const totalW = this.clientWidth();
    // In RTL, the navigation bar lives on the right side (~236px, or ~70px on narrow viewports).
    // Ensure the embedded webview never encroaches on the right edge or exceeds available width.
    const minSideWidth = totalW <= 860 ? 70 : 236;
    if (x + w > totalW - minSideWidth) {
      w = Math.max(10, totalW - minSideWidth - x);
    }
    this.siteBounds = { x, y, width: Math.max(10, w), height: Math.max(10, h) };
    this.layout();
  }

  // The view the student is looking at: the portal popup when there is one, otherwise the site browser.
  ActiveSiteCore() { return this.popupView && !this.popupView.wc.isDestroyed() ? this.popupView : this.site; }

  SiteAction(action) {
    const c = this.ActiveSiteCore();
    if (!c) return;
    if (action === 'back' && c.canGoBack) c.goBack();
    else if (action === 'forward' && c.canGoForward) c.goForward();
    else if (action === 'reload') c.reload();
    else if (action === 'print') c.wc.print({ printBackground: true });
    else if (action === 'savepdf') this.SavePageAsPdf();
    else if (action === 'copylink' && c.source) { try { clipboard.writeText(c.source); this.Toast('הקישור הועתק', false); } catch { } }
    else if (action === 'downloads') platform.openFolder(this.siteDownloadsDir || platform.Downloads);
    else if (action === 'external' && c.source) this.OpenExternal(c.source);
  }

  // DownloadStarting: files saved from Moodle / CS24 / the portal go straight into the course and lecture chosen above the site.
  OnSiteDownload(item, wc) {
    try {
      // Downloads that a module started itself (e.g. through downloadURL with its own target) set this flag.
      if (item.getSavePath && item.getSavePath()) return;
      const downloadCourse = this.siteDownloadCourse;
      const name = SafeName(item.getFilename());
      const { dir, where } = this.SiteSaveDir(name);
      mkdirp(dir);
      this.siteDownloadsDir = dir;
      const p = this.UniquePathIn(dir, name);
      item.setSavePath(p);
      const shown = path.basename(p);
      this.Send({ type: 'siteDownload', name: shown, dir, state: 'started', where });
      let lastPct = -1;
      item.on('updated', (_e, state) => {
        if (state !== 'progressing') return;
        const total = item.getTotalBytes();
        if (total <= 0) return;
        const pct = Math.min(99, Math.floor(item.getReceivedBytes() * 100 / total));
        if (pct === lastPct) return;
        lastPct = pct;
        this.Send({ type: 'siteDownload', name: shown, state: 'progress', pct, where });
      });
      item.once('done', (_e, state) => {
        if (state === 'completed') {
          this.Send({ type: 'siteDownload', name: shown, dir, path: p, state: 'done', where });
          if (downloadCourse) this.SendCourseLocal(downloadCourse);
        } else this.Send({ type: 'siteDownload', name: shown, dir, state: 'failed' });
      });
    } catch (ex) { try { item.cancel(); } catch { } this.Toast('לא ניתן לשמור את ההורדה: ' + ex.message, true); }
  }
}

// Mixins (the other C# partial-class files). Each module exports { init?(host), methods: { Name() {...} } }.
Host.modules = [];
function useModule(file) {
  let m;
  try { m = require(file); }
  catch (e) { if (e.code === 'MODULE_NOT_FOUND' && e.message.includes(file.replace('./', ''))) { console.warn('[sumit] module missing:', file); return; } throw e; }
  const methods = m.methods || {};
  for (const k of Object.getOwnPropertyNames(methods)) {
    if (Object.prototype.hasOwnProperty.call(Host.prototype, k)) throw new Error('Duplicate Host method ' + k + ' in ' + file);
    Object.defineProperty(Host.prototype, k, Object.getOwnPropertyDescriptor(methods, k));
  }
  Host.modules.push(m);
}
for (const f of ['ai', 'brains', 'council', 'helpers', 'moodle', 'moodle-downloads', 'new-material', 'cs24', 'lectures', 'lecture-pdf',
  'summary-queue', 'study-rendering', 'summary-book', 'course-operations', 'recordings', 'notability', 'selftest',
  'study-policy', 'summary-share', 'summary-chat'])
  useModule('./modules/' + f);

module.exports = { Host };
