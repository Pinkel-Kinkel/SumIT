'use strict';
// A thin stand-in for the WinForms WebView2 control, built on Electron's WebContentsView.
// Only the parts of the WebView2 API the app uses are provided; see PORTING.md for the mapping.

const fs = require('fs');
const path = require('path');
const { WebContentsView } = require('electron');
const { withTimeout, mkdirp } = require('./util');

class WebView {
  /**
   * @param {string} name     'ui' | 'zoom' | 'moodle' | 'site' | 'cs24' | 'print' | 'popup'
   * @param {object} opts     { session, preload, webContents (for popups created by window.open), background }
   */
  constructor(name, opts = {}) {
    this.name = name;
    const webPreferences = Object.assign({
      session: opts.session,
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // the hidden Moodle/CS24/Zoom browsers must keep running behind the app
      spellcheck: false,
    }, opts.webPreferences || {});
    this.view = new WebContentsView(opts.webContents ? { webContents: opts.webContents, webPreferences } : { webPreferences });
    this.wc = this.view.webContents;
    if (opts.background) this.view.setBackgroundColor(opts.background);
    this._responseWatchers = [];
  }

  // ----- WebView2-like surface -----
  get source() { try { return this.wc.isDestroyed() ? '' : this.wc.getURL(); } catch { return ''; } }
  get canGoBack() { return this.wc.navigationHistory.canGoBack(); }
  get canGoForward() { return this.wc.navigationHistory.canGoForward(); }
  goBack() { if (this.canGoBack) this.wc.navigationHistory.goBack(); }
  goForward() { if (this.canGoForward) this.wc.navigationHistory.goForward(); }
  reload() { this.wc.reload(); }
  get userAgent() { return this.wc.getUserAgent(); }
  set muted(v) { this.wc.setAudioMuted(!!v); }
  setDevTools(enabled) {
    if (enabled) return;
    this.wc.on('devtools-opened', () => this.wc.closeDevTools());
    this.wc.on('before-input-event', (e, input) => {
      if ((input.meta && input.alt && input.key.toLowerCase() === 'i') || input.key === 'F12') e.preventDefault();
    });
  }

  // CoreWebView2.Navigate - fire and forget, like the original. Navigation errors are reported by the page itself.
  navigate(url) { this.wc.loadURL(url).catch(() => { }); }
  // Awaitable variant: resolves when the page has finished loading (or failed).
  load(url) { return this.wc.loadURL(url).then(() => true, () => false); }

  executeScript(js) { return this.wc.executeJavaScript(js, true); }

  // Moodle.cs EvalAsync: runs `body` (the inside of an async function) and returns JSON.stringify(result) as a string.
  // Throws Error(page error message) or Error('הדף לא ענה בזמן') on timeout - same contract as the C# version.
  async evalAsync(body, timeoutMs = 30000) {
    const script = '(async()=>{try{const __v=await (async()=>{' + body + '\n})();'
      + 'return {ok:true,value:JSON.stringify(__v===undefined?null:__v)};}'
      + 'catch(e){return {ok:false,value:String((e&&e.message)||e)};}})()';
    let m;
    try { m = await withTimeout(this.wc.executeJavaScript(script, true), timeoutMs, 'הדף לא ענה בזמן'); }
    catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
    if (!m || !m.ok) throw new Error(m ? m.value : 'script failed');
    return m.value;
  }

  // CoreWebView2.PrintToPdfAsync(path, settings). Returns true on success.
  // opts: { landscape, printBackground, scale, pageSize ('A4'|{width,height} inches), margins {top,bottom,left,right} inches,
  //         displayHeaderFooter, headerTemplate, footerTemplate, preferCSSPageSize }
  async printToPdf(file, opts = {}) {
    try {
      const data = await this.wc.printToPDF(Object.assign({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }, opts));
      mkdirp(path.dirname(file));
      fs.writeFileSync(file, data);
      return true;
    } catch { return false; }
  }

  // CookieManager.GetCookiesAsync(url) -> [{ name, value, domain, path, secure, httpOnly, session, expirationDate }]
  cookies(url) { return this.wc.session.cookies.get(url ? { url } : {}); }

  // WebResourceResponseReceived + Response.GetContentAsync(): calls cb(url, bodyText, status) for every response whose
  // URL matches `test` (substring or RegExp). Uses the Chrome DevTools protocol (Electron's webRequest has no bodies).
  watchResponses(test, cb) {
    this._responseWatchers.push({ test, cb });
    if (this._cdp) return;
    this._cdp = true;
    const dbg = this.wc.debugger;
    const pending = new Map();
    const matches = (url) => this._responseWatchers.filter(w => typeof w.test === 'string' ? url.toLowerCase().includes(w.test.toLowerCase()) : w.test.test(url));
    const attach = () => {
      try { if (!dbg.isAttached()) dbg.attach('1.3'); dbg.sendCommand('Network.enable').catch(() => { }); } catch { }
    };
    attach();
    this.wc.on('did-start-navigation', attach);
    dbg.on('message', async (_e, method, params) => {
      if (method === 'Network.responseReceived') {
        if (matches(params.response.url).length) pending.set(params.requestId, { url: params.response.url, status: params.response.status });
      } else if (method === 'Network.loadingFinished' && pending.has(params.requestId)) {
        const info = pending.get(params.requestId); pending.delete(params.requestId);
        try {
          const r = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
          for (const w of matches(info.url)) { try { w.cb(info.url, body, info.status); } catch { } }
        } catch { }
      } else if (method === 'Network.loadingFailed') pending.delete(params.requestId);
    });
    dbg.on('detach', () => { setTimeout(attach, 500); });
  }

  destroy() { try { if (!this.wc.isDestroyed()) this.wc.close(); } catch { } }
}

module.exports = { WebView };
