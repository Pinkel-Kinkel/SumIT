'use strict';
/**
 * SumIT macOS — External Connectivity & AI Integration Verification Suite
 *
 * Verifies:
 * 1. Button Event Handlers & Triggers (Gemini & Claude cards, API key forms, External links, CLI/OAuth triggers).
 * 2. Network & API Request Validation (generativelanguage.googleapis.com & api.anthropic.com DNS/TLS resolution,
 *    headers, payloads, non-blocking async execution / event-loop lag).
 * 3. Error Handling & UI Feedback (401 Invalid API Key, 429 Rate Limit, Network Drop, Short Key, Spinners,
 *    Hebrew Toast notifications, and zero CORS / CSP / protocol errors in the Electron console).
 */

const dns = require('dns');
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const { app, protocol } = require('electron');
const { Host } = require('../lib/host');
const platform = require('../lib/platform');
const { delay } = require('../lib/util');

try { dns.setDefaultResultOrder('ipv4first'); } catch { }
platform.extendPath();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'https',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function pad(str, len) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

// Measure event-loop lag while an async operation runs
async function withEventLoopMonitor(fn) {
  let maxLagMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - last - 10);
    if (lag > maxLagMs) maxLagMs = lag;
    last = now;
  }, 10);
  try {
    const res = await fn();
    return { res, maxLagMs };
  } finally {
    clearInterval(timer);
  }
}

// Probe real DNS + TLS + HTTP status to an external endpoint
async function probeLiveEndpoint(hostname, pathUrl, method, headers, bodyObj) {
  const t0 = performance.now();
  let dnsMs = 0;
  let resolvedAddress = '';
  try {
    const d0 = performance.now();
    const lookup = await dns.promises.lookup(hostname);
    dnsMs = performance.now() - d0;
    resolvedAddress = `${lookup.address} (IPv${lookup.family})`;
  } catch (err) {
    return {
      reachable: false,
      dnsMs: performance.now() - t0,
      resolvedAddress: 'DNS_BLOCKED_OR_OFFLINE',
      status: 0,
      totalMs: performance.now() - t0,
      error: err.code || err.message,
    };
  }

  return new Promise((resolve) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const reqHeaders = Object.assign({}, headers);
    if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({
      hostname,
      port: 443,
      path: pathUrl,
      method,
      headers: reqHeaders,
      timeout: 8000,
    }, (res) => {
      const ttfbMs = performance.now() - t0;
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          reachable: true,
          dnsMs,
          resolvedAddress,
          status: res.statusCode,
          ttfbMs,
          totalMs: performance.now() - t0,
          bodySnippet: data.slice(0, 180).replace(/\s+/g, ' ').trim(),
        });
      });
    });
    req.on('error', (err) => {
      resolve({
        reachable: false,
        dnsMs,
        resolvedAddress,
        status: 0,
        totalMs: performance.now() - t0,
        error: err.code || err.message,
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Local mock server for deterministic inspection of Gemini & Claude headers, payloads, and HTTP status codes
function startMockAiServer() {
  const captured = [];
  let nextMode = '200'; // '200' | '401' | '429' | 'drop'

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', c => { rawBody += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(rawBody); } catch { }
      captured.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody,
        parsed,
      });

      if (nextMode === 'drop') {
        req.socket.destroy();
        return;
      }
      if (nextMode === '401') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '' } })); // empty message triggers Hebrew 401 fallback
        return;
      }
      if (nextMode === '429') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '' } })); // empty message triggers Hebrew 429 fallback
        return;
      }

      // 200 OK
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.includes(':generateContent')) {
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'מוכן' }] } }],
        }));
      } else if (req.url.includes('/v1/messages')) {
        res.end(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'מוכן' }],
        }));
      } else {
        res.end(JSON.stringify({
          choices: [{ message: { content: 'מוכן' } }],
        }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        captured,
        setMode(m) { nextMode = m; },
        close() { return new Promise(r => server.close(r)); },
      });
    });
  });
}

async function runVerification() {
  console.log('====================================================================================================');
  console.log(' SumIT macOS — External Connectivity & AI Integrations Verification (Gemini & Claude)');
  console.log('====================================================================================================\n');

  const results = [];
  const record = (category, name, ok, detail) => {
    results.push({ category, name, ok: !!ok, detail: String(detail || '') });
    const badge = ok ? 'PASS' : 'FAIL';
    console.log(`  [${badge}] [${category}] ${name}${detail ? ' — ' + detail : ''}`);
  };

  // Intercept platform.openExternal so we don't pop open real macOS browser tabs during automated testing,
  // while verifying exact URLs passed to shell.openExternal.
  const externalUrlsOpened = [];
  const origOpenExternal = platform.openExternal;
  platform.openExternal = (url) => {
    externalUrlsOpened.push(url);
    return Promise.resolve();
  };

  const mockServer = await startMockAiServer();
  process.env.SUMIT_GEMINI_URL = mockServer.baseUrl;
  process.env.SUMIT_ANTHROPIC_URL = mockServer.baseUrl;
  process.env.SUMIT_OPENAI_URL = mockServer.baseUrl;

  // Boot Host (with --demo=false but without running the selfTest quit)
  const host = new Host([]);
  await host.start();
  if (host.statusTimer) { clearInterval(host.statusTimer); host.statusTimer = null; }

  // Capture renderer console logs to check for CORS, CSP, or network protocol errors
  const consoleMessages = [];
  const cspOrCorsErrors = [];
  host.ui.wc.on('console-message', (ev) => {
    const message = ev && typeof ev === 'object' ? (ev.message || '') : '';
    const line = ev && typeof ev === 'object' ? ev.lineNumber : 0;
    const sourceId = ev && typeof ev === 'object' ? (ev.sourceId || '') : '';
    const level = ev && typeof ev === 'object' ? ev.level : 0;
    consoleMessages.push({ level, message, line, sourceId });
    if (/Content Security Policy|CSP|CORS|Access-Control-Allow-Origin|Refused to connect|Refused to load|ERR_UNKNOWN_URL_SCHEME/i.test(message)) {
      cspOrCorsErrors.push(`${message} (${sourceId}:${line})`);
    }
  });

  // Track messages sent from Host -> UI
  const uiMessages = [];
  const origSend = host.Send.bind(host);
  host.Send = (msg) => {
    if (msg && typeof msg === 'object') uiMessages.push(msg);
    return origSend(msg);
  };

  // Wait for UI to load https://app.local/ui.html and complete initial handshake
  for (let i = 0; i < 60 && (!host.ui.source || !host.ui.source.startsWith('https://app.local/')); i++) {
    await delay(100);
  }
  await delay(600);
  await host.SendSettings();
  await host.SendAiStatus();
  for (let i = 0; i < 40; i++) {
    await delay(100);
    const count = await host.ui.executeScript("document.querySelectorAll('#providers .provider').length").catch(() => 0);
    if (count === 3) break;
  }

  // Navigate to Settings view so #providers is visible
  await host.ui.executeScript("document.querySelector('.nav-item[data-view=\"settings\"]')?.click(); true;");
  await delay(150);

  console.log('\n--- 1. Button Event Handlers & Triggers (DOM -> IPC -> Host -> Action) ---');
  for (const cm of consoleMessages) {
    console.log('  [Renderer Console]', cm.level, cm.message, cm.sourceId + ':' + cm.line);
  }

  // 1a. Verify provider cards rendered in Settings (#providers) and Wizard (#wizProviders)
  const cardsInfo = await host.ui.executeScript(`(() => {
    const p = [...document.querySelectorAll('#providers .provider')].map(el => el.dataset.kind);
    const w = [...document.querySelectorAll('#wizProviders .provider')].map(el => el.dataset.kind);
    return { p, w };
  })()`);
  record(
    'Buttons',
    'Provider cards rendered (Claude, Gemini, ChatGPT)',
    JSON.stringify(cardsInfo.p) === '["claude","gemini","openai"]' && JSON.stringify(cardsInfo.w) === '["claude","gemini","openai"]',
    `settings=${JSON.stringify(cardsInfo.p)}, wizard=${JSON.stringify(cardsInfo.w)}`
  );

  // 1b. Click "איך משיגים מפתח?" ([data-getkey]) on Gemini card -> verifies openGeminiKeyPage -> shell.openExternal
  externalUrlsOpened.length = 0;
  await host.ui.executeScript(`(() => {
    const btn = document.querySelector('#providers .provider[data-kind="gemini"] [data-getkey]');
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  await delay(150);
  record(
    'Buttons',
    'Gemini "Get API Key" button ([data-getkey]) launches external URL',
    externalUrlsOpened.includes('https://aistudio.google.com/apikey'),
    `opened=${externalUrlsOpened.join(', ') || 'none'}`
  );

  // 1c. Verify OpenExternal protocol guard (blocks javascript:/file: URIs, allows https:)
  externalUrlsOpened.length = 0;
  host.OpenExternal('javascript:alert(1)');
  host.OpenExternal('file:///etc/passwd');
  host.OpenExternal('https://claude.ai/login');
  record(
    'Security',
    'OpenExternal protocol sandboxing (allows https:, blocks javascript:/file:)',
    externalUrlsOpened.length === 1 && externalUrlsOpened[0] === 'https://claude.ai/login',
    `allowed=${JSON.stringify(externalUrlsOpened)}`
  );

  // 1d. Click Claude setup button ([data-act="setupClaude"]) -> verifies IPC trigger & loading spinner feedback
  let setupClaudeTriggered = false;
  const origSetupClaude = host.SetupClaude.bind(host);
  host.SetupClaude = async () => {
    setupClaudeTriggered = true;
    host.setupState = 'login-claude';
    await host.SendAiStatus();
  };
  // Ensure Claude card shows setupClaude button
  host.settings.claudeOk = false;
  await host.SendAiStatus();
  await delay(200);
  await host.ui.executeScript(`(() => {
    const btn = document.querySelector('#providers .provider[data-kind="claude"] [data-act="setupClaude"]');
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  let claudeSpinnerHtml = "";
  for (let i = 0; i < 20; i++) {
    await delay(100);
    claudeSpinnerHtml = await host.ui.executeScript(`document.querySelector('#providers .provider[data-kind="claude"] .state')?.innerHTML || ''`);
    if (claudeSpinnerHtml.includes("spinner")) break;
  }
  record(
    'Buttons',
    'Claude Setup/Login button ([data-act="setupClaude"]) & spinner state',
    setupClaudeTriggered && claudeSpinnerHtml.includes('spinner') && claudeSpinnerHtml.includes('ממתין להתחברות בדפדפן'),
    `triggered=${setupClaudeTriggered}, state="${claudeSpinnerHtml.replace(/<[^>]+>/g, ' ').trim()}"`
  );
  host.setupState = '';
  host.SetupClaude = origSetupClaude;
  await host.SendAiStatus();
  await delay(200);

  // 1e. Click Gemini Google Account Connect button ([data-login]) -> verifies ConnectBrain('gemini') & spinner
  let connectBrainArg = null;
  const origConnectBrain = host.ConnectBrain.bind(host);
  host.ConnectBrain = async (kind) => {
    connectBrainArg = kind;
    host.setupState = 'login-gemini';
    await host.SendAiStatus();
  };
  delete host.settings.geminiKey;
  host.settings.agyOk = false;
  host.geminiSignedOverride = false;
  await host.SendAiStatus();
  await delay(300);
  const clickResult = await host.ui.executeScript(`(() => {
    const btn = document.querySelector('#providers .provider[data-kind="gemini"] [data-login]');
    if (btn) { btn.click(); return { clicked: true, text: btn.textContent }; }
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    return { clicked: false, cardHtml: card ? card.innerHTML : null };
  })()`);
  await delay(400);
  const geminiSpinnerHtml = await host.ui.executeScript(`document.querySelector('#providers .provider[data-kind="gemini"] .state')?.innerHTML || ''`);
  record(
    'Buttons',
    'Gemini Connect Account button ([data-login]) & spinner state',
    connectBrainArg === 'gemini' && geminiSpinnerHtml.includes('spinner') && geminiSpinnerHtml.includes('מכין את ההתחברות ל-Google'),
    `click=${JSON.stringify(clickResult)}, kind=${connectBrainArg}, state="${geminiSpinnerHtml.replace(/<[^>]+>/g, ' ').trim()}"`
  );
  host.setupState = '';
  host.ConnectBrain = origConnectBrain;
  await host.SendAiStatus();
  await delay(200);

  // Layout responsiveness test across standard resolutions
  const testResolutions = [
    { width: 820, height: 620, label: 'Compact' },
    { width: 1440, height: 900, label: 'MacBook' },
  ];
  for (const r of testResolutions) {
    host.win.setContentSize(r.width, r.height);
    await delay(150);
    const layout = await host.ui.executeScript(`(() => {
      show('sites');
      const side = document.querySelector('nav.side');
      const sideRect = side ? side.getBoundingClientRect() : null;
      const siteBar = document.querySelector('.site-bar');
      const barRect = siteBar ? siteBar.getBoundingClientRect() : null;
      const siteHost = document.querySelector('#siteHost');
      const hostRect = siteHost ? siteHost.getBoundingClientRect() : null;
      return {
        sideTop: sideRect?.top,
        siteBarVisible: !!barRect && barRect.top >= 0 && barRect.bottom <= window.innerHeight,
        siteHostHeight: hostRect ? hostRect.height : 0
      };
    })()`);
    record(
      'Layout',
      'Site bar & navigation docked and visible at ' + r.label + ' (' + r.width + 'x' + r.height + ')',
      layout.sideTop >= 0 && layout.siteBarVisible && layout.siteHostHeight > 200,
      'sideTop=' + layout.sideTop + ', siteBarVisible=' + layout.siteBarVisible + ', siteHostHeight=' + layout.siteHostHeight + 'px'
    );
  }

  // 1f. Sidebar #aiPill button click when AI is not ready -> opens onboarding wizard
  await host.ui.executeScript(`(() => {
    document.getElementById('wizard').hidden = true;
    document.getElementById('aiPill').click();
    return true;
  })()`);
  await delay(100);
  const wizardOpened = await host.ui.executeScript(`!document.getElementById('wizard').hidden`);
  await host.ui.executeScript(`document.getElementById('wizard').hidden = true; true;`);
  record(
    'Buttons',
    'Sidebar #aiPill button opens connection wizard when disconnected',
    wizardOpened === true,
    `wizardVisible=${wizardOpened}`
  );

  console.log('\n--- 2. Network & API Request Validation (Gemini & Claude Endpoints, Headers, Payloads, Async) ---');

  // 2a. Validate Gemini API call (generativelanguage.googleapis.com format)
  mockServer.captured.length = 0;
  mockServer.setMode('200');
  const gemMonitor = await withEventLoopMonitor(() =>
    host.HelperCall('gemini', 'AIzaSyTestKey123456789012345', 'You are a tutor.', [['user', 'Say ok']])
  );
  const gemReq = mockServer.captured[0];
  const gemHeadersOk = gemReq
    && gemReq.url.includes('/v1beta/models/')
    && gemReq.headers['x-goog-api-key'] === 'AIzaSyTestKey123456789012345'
    && (gemReq.headers['content-type'] || '').includes('application/json');
  const gemBodyOk = gemReq && gemReq.parsed
    && gemReq.parsed.systemInstruction?.parts?.[0]?.text === 'You are a tutor.'
    && gemReq.parsed.contents?.[0]?.role === 'user'
    && gemReq.parsed.contents?.[0]?.parts?.[0]?.text === 'Say ok';
  record(
    'Network',
    'Gemini API request formatting (path, x-goog-api-key header, JSON payload)',
    gemHeadersOk && gemBodyOk && !gemMonitor.res.Error && gemMonitor.res.Text === 'מוכן',
    `path=${gemReq?.url}, header=x-goog-api-key, reply="${gemMonitor.res.Text}", maxEventLoopLag=${gemMonitor.maxLagMs.toFixed(2)}ms`
  );

  // 2b. Validate Claude API call (api.anthropic.com format)
  mockServer.captured.length = 0;
  mockServer.setMode('200');
  const claudeMonitor = await withEventLoopMonitor(() =>
    host.HelperCall('claude', 'sk-ant-api03-TestKey1234567890', 'You are a tutor.', [['user', 'Say ok']])
  );
  const claudeReq = mockServer.captured[0];
  const claudeHeadersOk = claudeReq
    && claudeReq.url === '/v1/messages'
    && claudeReq.headers['x-api-key'] === 'sk-ant-api03-TestKey1234567890'
    && claudeReq.headers['anthropic-version'] === '2023-06-01'
    && (claudeReq.headers['content-type'] || '').includes('application/json');
  const claudeBodyOk = claudeReq && claudeReq.parsed
    && claudeReq.parsed.system === 'You are a tutor.'
    && claudeReq.parsed.max_tokens === 2048
    && claudeReq.parsed.messages?.[0]?.role === 'user'
    && claudeReq.parsed.messages?.[0]?.content === 'Say ok';
  record(
    'Network',
    'Claude API request formatting (path, x-api-key, anthropic-version, JSON payload)',
    claudeHeadersOk && claudeBodyOk && !claudeMonitor.res.Error && claudeMonitor.res.Text === 'מוכן',
    `path=${claudeReq?.url}, headers=x-api-key+anthropic-version, reply="${claudeMonitor.res.Text}", maxEventLoopLag=${claudeMonitor.maxLagMs.toFixed(2)}ms`
  );

  // 2c. Live macOS DNS & TLS probe to generativelanguage.googleapis.com and api.anthropic.com
  const liveGemini = await probeLiveEndpoint(
    'generativelanguage.googleapis.com',
    '/v1beta/models/gemini-flash-latest:generateContent',
    'POST',
    { 'Content-Type': 'application/json', 'x-goog-api-key': 'INVALID_PROBE_KEY' },
    { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }
  );
  const liveClaude = await probeLiveEndpoint(
    'api.anthropic.com',
    '/v1/messages',
    'POST',
    { 'Content-Type': 'application/json', 'x-api-key': 'INVALID_PROBE_KEY', 'anthropic-version': '2023-06-01' },
    { model: 'claude-3-5-haiku-latest', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
  );

  if (liveGemini.reachable) {
    record(
      'LiveDNS',
      'macOS resolution & TLS handshake to generativelanguage.googleapis.com',
      liveGemini.status === 400 || liveGemini.status === 403,
      `IP=${liveGemini.resolvedAddress}, HTTP=${liveGemini.status}, DNS=${liveGemini.dnsMs.toFixed(1)}ms, Total=${liveGemini.totalMs.toFixed(1)}ms`
    );
  } else {
    console.log(`  [INFO] [LiveDNS] generativelanguage.googleapis.com offline in sandbox (${liveGemini.error})`);
  }

  if (liveClaude.reachable) {
    record(
      'LiveDNS',
      'macOS resolution & TLS handshake to api.anthropic.com',
      liveClaude.status === 401 || liveClaude.status === 403,
      `IP=${liveClaude.resolvedAddress}, HTTP=${liveClaude.status}, DNS=${liveClaude.dnsMs.toFixed(1)}ms, Total=${liveClaude.totalMs.toFixed(1)}ms`
    );
  } else {
    console.log(`  [INFO] [LiveDNS] api.anthropic.com offline in sandbox (${liveClaude.error})`);
  }

  console.log('\n--- 3. Error Handling & UI Feedback (Invalid Key, Rate Limit, Network Drop, Focus Bug Fix) ---');

  // Ensure Gemini has no key or account connected before testing API key input
  delete host.settings.geminiKey;
  host.settings.agyOk = false;
  host.geminiSignedOverride = false;
  await host.SendAiStatus();
  await delay(150);

  // 3a. Short API key (< 20 chars) + Enter key focus bug regression check
  await host.ui.executeScript(`(() => {
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    const det = card.querySelector('details.adv');
    if (det) det.open = true;
    const input = card.querySelector('[data-key]');
    input.focus();
    input.value = 'short_key_123';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await delay(200);
  const shortKeyState = await host.ui.executeScript(`(() => {
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    const btn = card.querySelector('[data-save]');
    const toastEl = document.querySelector('#toasts .toast.error');
    return {
      btnDisabled: btn ? btn.disabled : null,
      btnText: btn ? btn.textContent : null,
      toastText: toastEl ? toastEl.textContent : '',
    };
  })()`);
  record(
    'ErrorUI',
    'Short API key rejected with Hebrew toast AND button resets from "בודק..." to "חבר" while input focused',
    shortKeyState.btnDisabled === false && shortKeyState.btnText === 'חבר' && shortKeyState.toastText.includes('המפתח נראה קצר מדי'),
    `btnDisabled=${shortKeyState.btnDisabled}, btnText="${shortKeyState.btnText}", toast="${shortKeyState.toastText}"`
  );

  // 3b. Invalid API key (401 Unauthorized) via UI [data-save] click
  mockServer.setMode('401');
  await host.ui.executeScript(`(() => {
    document.querySelectorAll('#toasts .toast').forEach(t => t.remove());
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    const input = card.querySelector('[data-key]');
    const btn = card.querySelector('[data-save]');
    input.value = 'AIzaSyInvalidKey000000000000000000';
    btn.click();
    return true;
  })()`);
  await delay(250);
  const invalidKeyUi = await host.ui.executeScript(`(() => {
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    const btn = card.querySelector('[data-save]');
    const toastEl = document.querySelector('#toasts .toast.error');
    return {
      btnDisabled: btn ? btn.disabled : null,
      btnText: btn ? btn.textContent : null,
      toastText: toastEl ? toastEl.textContent : '',
    };
  })()`);
  record(
    'ErrorUI',
    '401 Invalid API Key displays Hebrew error toast ("המפתח לא התקבל") and re-enables button',
    invalidKeyUi.btnDisabled === false && invalidKeyUi.btnText === 'חבר' && invalidKeyUi.toastText.includes('המפתח לא התקבל'),
    `toast="${invalidKeyUi.toastText}", btnText="${invalidKeyUi.btnText}"`
  );

  // 3c. Rate-limiting (429 Too Many Requests) on both Gemini and Claude
  mockServer.setMode('429');
  const gem429 = await host.HelperCall('gemini', 'AIzaSyRateLimitKey000000000000000', 'sys', [['user', 'hi']]);
  const claude429 = await host.HelperCall('claude', 'sk-ant-RateLimitKey00000000000000', 'sys', [['user', 'hi']]);
  record(
    'ErrorUI',
    '429 Rate Limit sets Limit=true and Hebrew quota message ("המכסה של ה-AI נגמרה לעכשיו")',
    gem429.Error && gem429.Limit && gem429.Text === 'המכסה של ה-AI נגמרה לעכשיו'
      && claude429.Error && claude429.Limit && claude429.Text === 'המכסה של ה-AI נגמרה לעכשיו',
    `gemini="${gem429.Text}" (Limit=${gem429.Limit}), claude="${claude429.Text}" (Limit=${claude429.Limit})`
  );

  // 3d. Network drop / socket hangup handling
  mockServer.setMode('drop');
  const gemDrop = await host.HelperCall('gemini', 'AIzaSyDropKey00000000000000000000', 'sys', [['user', 'hi']]);
  const claudeDrop = await host.HelperCall('claude', 'sk-ant-DropKey0000000000000000000', 'sys', [['user', 'hi']]);
  record(
    'ErrorUI',
    'Network socket drop caught gracefully without unhandled rejection',
    gemDrop.Error && gemDrop.Text.length > 0 && claudeDrop.Error && claudeDrop.Text.length > 0,
    `geminiErr="${gemDrop.Text}", claudeErr="${claudeDrop.Text}"`
  );

  // 3e. Valid API key (200 OK) saves encrypted key, updates card to "מחובר עם מפתח", and passes TestBrain
  mockServer.setMode('200');
  await host.ui.executeScript(`(() => {
    document.querySelectorAll('#toasts .toast').forEach(t => t.remove());
    const card = document.querySelector('#providers .provider[data-kind="gemini"]');
    const input = card.querySelector('[data-key]');
    const btn = card.querySelector('[data-save]');
    input.value = 'AIzaSyValidKey12345678901234567890';
    btn.click();
    return true;
  })()`);
  let validKeyUi = { stateText: "", toastText: "" };
  for (let i = 0; i < 20; i++) {
    await delay(100);
    validKeyUi = await host.ui.executeScript(`(() => {
      const card = document.querySelector('#providers .provider[data-kind="gemini"]');
      const stateText = card ? (card.querySelector('.state')?.textContent || '') : '';
      const toastEl = document.querySelector('#toasts .toast:not(.error)');
      return {
        stateText: stateText.trim(),
        toastText: toastEl ? toastEl.textContent : '',
      };
    })()`);
    if (validKeyUi.stateText.includes("מחובר עם מפתח")) break;
  }
  record(
    'Buttons',
    'Valid Gemini API key saves encrypted key & updates UI card to connected',
    host.HelperMode('gemini') === 'key' && validKeyUi.stateText.includes('מחובר עם מפתח') && validKeyUi.toastText.includes('Gemini חובר'),
    `mode=${host.HelperMode('gemini')}, state="${validKeyUi.stateText}", toast="${validKeyUi.toastText}"`
  );

  // Clean up test key
  host.RemoveHelperKey('gemini');
  await delay(100);

  // 3f. Verify Claude card Test ([data-act="testClaude"]) & Disconnect ([data-act="disconnectClaude"]) buttons
  host.settings.claudeOk = true;
  const origClaudeSignedIn = host.ClaudeSignedIn.bind(host);
  const origAiStatus = host.AiStatus.bind(host);
  host.AiStatus = async () => {
    const s = await origAiStatus();
    if (host.settings.claudeOk) {
      s.claude.installed = true;
      s.claude.loggedIn = true;
      s.claude.email = 'student@hit.ac.il';
      s.ready = true;
    }
    return s;
  };
  await host.SendAiStatus();
  await delay(150);

  // Click [data-act="testClaude"]
  await host.ui.executeScript(`(() => {
    const btn = document.querySelector('#providers .provider[data-kind="claude"] [data-act="testClaude"]');
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  for (let i = 0; i < 20; i++) { await delay(100); const t = await host.ui.executeScript(`document.querySelector('#providers .provider[data-kind="claude"] .test-line')?.textContent || ''`); if (t && t.includes('✓')) break; }
  const claudeTestLine = await host.ui.executeScript(`document.querySelector('#providers .provider[data-kind="claude"] .test-line')?.textContent || ''`);
  record(
    'Buttons',
    'Claude "Test Connection" button ([data-act="testClaude"]) verifies status and renders result',
    claudeTestLine.includes('✓ ענה תוך'),
    `testLine="${claudeTestLine.trim()}"`
  );

  // Click [data-act="disconnectClaude"] (auto-confirm dialog in renderer)
  await host.ui.executeScript(`(() => {
    window.confirm = () => true;
    const btn = document.querySelector('#providers .provider[data-kind="claude"] [data-act="disconnectClaude"]');
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  await delay(200);
  record(
    'Buttons',
    'Claude "Disconnect" button ([data-act="disconnectClaude"]) unlinks Claude cleanly',
    host.settings.claudeOk === false && host.claudeLoggedIn === false,
    `claudeOk=${host.settings.claudeOk}, claudeLoggedIn=${host.claudeLoggedIn}`
  );
  host.AiStatus = origAiStatus;
  host.ClaudeSignedIn = origClaudeSignedIn;

  // 3g. Check renderer console for any CORS, CSP, or protocol errors
  record(
    'Console/CSP',
    'Zero CORS, Content-Security-Policy, or protocol errors in renderer console',
    cspOrCorsErrors.length === 0,
    `totalConsoleLogs=${consoleMessages.length}, cspOrCorsErrors=${cspOrCorsErrors.length}`
  );

  await mockServer.close();
  platform.openExternal = origOpenExternal;

  const passed = results.filter(r => r.ok).length;
  console.log('\n====================================================================================================');
  console.log(` SUMMARY: ${passed}/${results.length} checks passed`);
  console.log('====================================================================================================\n');

  try { if (host.win && !host.win.isDestroyed()) host.win.close(); } catch { }
  app.exit(passed === results.length ? 0 : 1);
}

app.whenReady().then(runVerification).catch((err) => {
  console.error('Fatal error in verify-ai-connectivity:', err);
  app.exit(1);
});
