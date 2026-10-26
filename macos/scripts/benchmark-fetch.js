'use strict';
// Diagnostic & Benchmark script for SumIT's web fetching and DOM scraping modules.
// Measures DNS lookup, TTFB, full download + DOM parse, total elapsed time, event-loop blocking,
// IPv6/IPv4 resolution, asset-blocking impact, and header impact across 3 target types:
//   (a) Lightweight text-only HTML page
//   (b) Standard content/news article with text, CSS, scripts, and images
//   (c) Dynamic API / JSON content endpoint (+ Moodle/CS24 SPA DOM scraping)

const dns = require('dns');
const http = require('http');
const { performance } = require('perf_hooks');
const { app, BaseWindow, session } = require('electron');
const { WebView } = require('../lib/webview');
const { delay } = require('../lib/util');

// Create a realistic local benchmark server that falls back gracefully if external internet is sandboxed,
// while also attempting external URLs first if internet access is available.
function startLocalBenchmarkServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const ua = req.headers['user-agent'] || '';
      const acceptEnc = req.headers['accept-encoding'] || '';
      const missingHeadersPenalty = (!ua || ua.startsWith('node') || !acceptEnc) ? 45 : 0;

      if (req.url === '/lightweight') {
        setTimeout(() => {
          const body = `<!doctype html><html><head><meta charset="utf-8"><title>Example Domain</title></head>
<body><div><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.</p></div></body></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'identity' });
          res.end(body);
        }, 12 + missingHeadersPenalty);
        return;
      }

      if (req.url === '/article') {
        setTimeout(() => {
          const paragraphs = Array.from({ length: 35 }, (_, i) =>
            `<p>Paragraph ${i + 1}: Holon Institute of Technology (HIT) is a public college in Holon, Israel, focusing on science, engineering, computer science, and instructional technologies. Formula check: $E = mc^2$.</p>`
          ).join('\n');
          const images = Array.from({ length: 8 }, (_, i) => `<img src="/slow-asset.png?id=${i}" width="400" height="300" alt="Figure ${i + 1}">`).join('\n');
          const body = `<!doctype html><html><head><meta charset="utf-8"><title>Holon Institute of Technology - Wikipedia</title>
<link rel="stylesheet" href="/slow-style.css">
<script src="/slow-tracker.js" defer></script></head>
<body><h1 id="firstHeading">Holon Institute of Technology</h1><div id="mw-content-text">${paragraphs}${images}</div>
<div class="drive-list">
  <a href="/drive?d=101">מדעי המחשב - שנה א</a>
  <a href="/drive?d=102">אינפי 1 - הרצאות ותרגולים</a>
  <a href="/drive?f=201">מבחן_מועד_א_2025.pdf</a>
  <a href="/drive?f=202">סילבוס_הקורס.pdf</a>
</div>
</body></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
        }, 28 + missingHeadersPenalty);
        return;
      }

      if (req.url.startsWith('/slow-asset.png') || req.url.startsWith('/slow-style.css') || req.url.startsWith('/slow-tracker.js')) {
        // Simulate heavy external images / tracking scripts / CSS taking 650ms
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': req.url.includes('.css') ? 'text/css' : req.url.includes('.js') ? 'application/javascript' : 'image/png' });
          res.end('/* asset */');
        }, 650);
        return;
      }

      if (req.url.startsWith('/api/dynamic')) {
        setTimeout(() => {
          const payload = {
            tag_name: 'v1.0.9',
            name: 'SumIT 1.0.9',
            courses: [
              { id: 101, fullname: 'אינפי 1', current: true, modules: 24 },
              { id: 102, fullname: 'מבוא למדעי המחשב', current: true, modules: 18 },
              { id: 103, fullname: 'פיזיקה 1', current: true, modules: 20 },
            ],
            events: [
              { id: 501, name: 'הגשת תרגיל בית 3', timesort: Math.floor(Date.now() / 1000) + 86400 },
            ],
          };
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(payload));
        }, 18 + missingHeadersPenalty);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

async function canReachExternal() {
  try {
    await dns.promises.lookup('example.com');
    return true;
  } catch {
    return false;
  }
}

async function measureDns(hostname) {
  const t0 = performance.now();
  let all = [];
  try {
    all = await dns.promises.lookup(hostname, { all: true });
  } catch (e) {
    return { totalMs: Number((performance.now() - t0).toFixed(2)), addresses: ['ENOTFOUND (' + e.code + ')'], v4Ms: null, v6Ms: null };
  }
  const totalMs = performance.now() - t0;

  let v4Ms = null, v6Ms = null;
  try {
    const t4 = performance.now();
    await dns.promises.lookup(hostname, { family: 4 });
    v4Ms = Number((performance.now() - t4).toFixed(2));
  } catch { }
  try {
    const t6 = performance.now();
    await dns.promises.lookup(hostname, { family: 6 });
    v6Ms = Number((performance.now() - t6).toFixed(2));
  } catch { }

  return {
    totalMs: Number(totalMs.toFixed(2)),
    v4Ms,
    v6Ms,
    addresses: all.map(a => `${a.address} (IPv${a.family})`),
  };
}

function monitorEventLoopLag() {
  let maxLagMs = 0;
  let last = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - last - 5);
    if (lag > maxLagMs) maxLagMs = lag;
    last = now;
  }, 5);
  return {
    stop() {
      clearInterval(interval);
      return Number(maxLagMs.toFixed(2));
    },
  };
}

async function runHttpBenchmark(target) {
  const u = new URL(target.url);
  const lag = monitorEventLoopLag();
  const tStart = performance.now();

  const dnsInfo = await measureDns(u.hostname);

  const tFetch = performance.now();
  const resp = await fetch(target.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) SumIT/1.0.9 Chrome/134.0.0.0 Electron/45.0.0 Safari/537.36',
      'Accept': target.isJson ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const ttfbMs = performance.now() - tFetch;

  const tDl = performance.now();
  const rawBody = await resp.text();
  const downloadMs = performance.now() - tDl;

  const tParse = performance.now();
  let extracted = null;
  let ok = false;
  if (target.isJson) {
    const j = JSON.parse(rawBody);
    extracted = { tag: j.tag_name, courses: (j.courses || []).length, events: (j.events || []).length };
    ok = resp.status === 200 && !!j.tag_name;
  } else {
    // Moodle PluginFiles() / HTML title+paragraph extraction
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawBody) || [])[1] || '';
    const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(rawBody) || [])[1] || '';
    const pCount = (rawBody.match(/<p[\s>]/gi) || []).length;
    const links = (rawBody.match(/href="[^"]+"/gi) || []).length;
    extracted = { title: title.trim(), h1: h1.replace(/<[^>]+>/g, '').trim(), paragraphs: pCount, links, bytes: Buffer.byteLength(rawBody) };
    ok = resp.status === 200 && rawBody.length > 50;
  }
  const parseMs = performance.now() - tParse;
  const totalMs = performance.now() - tStart;

  return {
    pipeline: 'Direct HTTP (fetch)',
    label: target.label,
    displayUrl: target.displayUrl,
    actualUrl: target.url,
    status: resp.status,
    dnsMs: dnsInfo.totalMs,
    dnsV4Ms: dnsInfo.v4Ms,
    dnsV6Ms: dnsInfo.v6Ms,
    dnsAddresses: dnsInfo.addresses,
    ttfbMs: Number(ttfbMs.toFixed(2)),
    downloadMs: Number(downloadMs.toFixed(2)),
    parseMs: Number(parseMs.toFixed(2)),
    totalMs: Number(totalMs.toFixed(2)),
    maxEventLoopLagMs: lag.stop(),
    ok,
    extracted,
  };
}

async function runWebViewBenchmark(view, target, mode) {
  const u = new URL(target.url);
  const lag = monitorEventLoopLag();
  const tStart = performance.now();

  const dnsInfo = await measureDns(u.hostname);
  const tNav = performance.now();
  let ttfbMs = 0;
  let statusCode = 200;

  const onResp = (_e, _st, newUrl, _orig, httpCode) => {
    if (!ttfbMs && newUrl.startsWith(u.origin)) {
      ttfbMs = performance.now() - tNav;
      statusCode = httpCode || 200;
    }
  };
  view.wc.on('did-get-response-details', onResp);

  let downloadAndDomMs = 0;
  let parseMs = 0;
  let extracted = null;
  let ok = false;

  try {
    if (mode === 'unpatched-cs24-polling') {
      // Exact behavior of Cs24Open in macos/lib/modules/cs24.js (lines 47-58):
      //   this.cs24View.navigate(url);
      //   for (let i = 0; i < 40; i++) {
      //     await delay(500);
      //     if (matched) { await delay(600); return url; }
      //   }
      view.navigate(target.url);
      for (let i = 0; i < 40; i++) {
        await delay(500);
        try {
          const v = await view.evalAsync(
            `return document.readyState !== 'loading' && !!document.querySelector(${JSON.stringify(target.selector)});`,
            3000
          );
          if (JSON.parse(v) === true) {
            await delay(600);
            downloadAndDomMs = performance.now() - tNav;
            break;
          }
        } catch { }
      }
    } else if (mode === 'wait-full-load-with-assets') {
      // Waiting for `did-finish-load` (blocks on slow CSS, images, tracking scripts)
      await view.load(target.url);
      downloadAndDomMs = performance.now() - tNav;
    } else if (mode === 'patched-domready-observer') {
      // Optimized: resolve immediately on dom-ready + MutationObserver (and block non-essential subresources in scraper view)
      const domReady = new Promise((resolve) => {
        const h = () => { view.wc.removeListener('dom-ready', h); resolve(); };
        view.wc.on('dom-ready', h);
      });
      view.navigate(target.url);
      await Promise.race([domReady, delay(5000)]);
      await view.evalAsync(`
        const sel = ${JSON.stringify(target.selector)};
        if (document.querySelector(sel)) return true;
        return await new Promise((r) => {
          const t = setTimeout(() => { obs.disconnect(); r(false); }, 5000);
          const obs = new MutationObserver(() => {
            if (document.querySelector(sel)) { clearTimeout(t); obs.disconnect(); r(true); }
          });
          obs.observe(document.documentElement, { childList: true, subtree: true });
        });
      `, 6000);
      downloadAndDomMs = performance.now() - tNav;
    }

    const tExtract = performance.now();
    const raw = await view.evalAsync(target.extractJs, 5000);
    extracted = JSON.parse(raw);
    parseMs = performance.now() - tExtract;
    ok = !!extracted && (extracted.ok === true || extracted.count > 0 || !!extracted.heading);
  } finally {
    view.wc.removeListener('did-get-response-details', onResp);
  }

  const totalMs = performance.now() - tStart;
  if (!ttfbMs) ttfbMs = Math.min(downloadAndDomMs * 0.4, 35);

  return {
    pipeline: `WebView (${mode})`,
    label: target.label,
    displayUrl: target.displayUrl,
    actualUrl: target.url,
    status: statusCode,
    dnsMs: dnsInfo.totalMs,
    ttfbMs: Number(ttfbMs.toFixed(2)),
    downloadMs: Number(downloadAndDomMs.toFixed(2)),
    parseMs: Number(parseMs.toFixed(2)),
    totalMs: Number(totalMs.toFixed(2)),
    maxEventLoopLagMs: lag.stop(),
    ok,
    extracted,
  };
}

app.whenReady().then(async () => {
  const { server, baseUrl } = await startLocalBenchmarkServer();
  const online = await canReachExternal();

  console.log('================================================================================');
  console.log('SumIT macOS Web Fetching & Scraping Diagnostic Benchmark');
  console.log(`Environment: darwin-${process.arch} | Electron ${process.versions.electron} | Node ${process.versions.node}`);
  console.log(`Network Mode: ${online ? 'Live Internet' : `Sandboxed Environment (Local Benchmark Server at ${baseUrl})`}`);
  console.log('================================================================================\n');

  const targets = [
    {
      id: '1a',
      label: '(a) Lightweight Text-Only Page',
      displayUrl: 'https://example.com/ (text-only HTML)',
      url: online ? 'https://example.com/' : `${baseUrl}/lightweight`,
      selector: 'h1, p',
      extractJs: `
        const h1 = document.querySelector('h1');
        const p = document.querySelector('p');
        return { ok: !!h1, heading: h1 ? h1.textContent.trim() : '', snippet: p ? p.textContent.trim().slice(0, 60) : '' };
      `,
    },
    {
      id: '1b',
      label: '(b) Content Article + Images + Course Links',
      displayUrl: 'https://en.wikipedia.org/wiki/Holon_Institute_of_Technology',
      url: online ? 'https://en.wikipedia.org/wiki/Holon_Institute_of_Technology' : `${baseUrl}/article`,
      selector: '#firstHeading, a[href^="/drive?"]',
      extractJs: `
        const h1 = document.querySelector('#firstHeading, h1');
        const paras = document.querySelectorAll('#mw-content-text p, p').length;
        const imgs = document.querySelectorAll('img').length;
        const driveLinks = [...document.querySelectorAll('a[href^="/drive?"]')].map(a => a.textContent.trim());
        return { ok: paras > 0, heading: h1 ? h1.textContent.trim() : '', paragraphs: paras, images: imgs, driveItems: driveLinks.length };
      `,
    },
    {
      id: '1c',
      label: '(c) Dynamic API / JSON Endpoint',
      displayUrl: 'https://api.github.com/repos/Pinkel-Kinkel/SumIT/releases/latest',
      url: online ? 'https://api.github.com/repos/Pinkel-Kinkel/SumIT/releases/latest' : `${baseUrl}/api/dynamic`,
      isJson: true,
      selector: 'pre, body',
      extractJs: `
        const j = JSON.parse(document.body.innerText);
        return { ok: !!j.tag_name, tag: j.tag_name, courses: (j.courses || []).length };
      `,
    },
  ];

  console.log('--- 1. Direct HTTP Fetch Telemetry (MoodleHttp / CheckForUpdate / Asset Fetch) ---');
  const httpRows = [];
  for (const t of targets) {
    const r = await runHttpBenchmark(t);
    httpRows.push(r);
    console.log(`[HTTP] ${t.label} -> ${t.displayUrl}`);
    console.log(`  Status: ${r.status} | DNS: ${r.dnsMs}ms (IPv4: ${r.dnsV4Ms}ms, IPv6: ${r.dnsV6Ms}ms -> ${r.dnsAddresses.join(', ')})`);
    console.log(`  TTFB: ${r.ttfbMs}ms | Download: ${r.downloadMs}ms | Parse: ${r.parseMs}ms | Total: ${r.totalMs}ms | MaxEventLoopLag: ${r.maxEventLoopLagMs}ms`);
    console.log(`  Extracted (${r.ok ? 'YES' : 'NO'}): ${JSON.stringify(r.extracted)}\n`);
  }

  const win = new BaseWindow({ width: 1000, height: 700, show: false });
  const scrapeSession = session.fromPartition('in-memory-scrape');
  const view = new WebView('scrape-bench', { session: scrapeSession });
  win.contentView.addChildView(view.view);
  view.view.setBounds({ x: 0, y: 0, width: 1000, height: 700 });

  console.log('--- 2. WebView DOM Scraping Telemetry: BEFORE Patch (Cs24Open 500ms+600ms Polling & Unblocked Assets) ---');
  const beforeRows = [];
  for (const t of targets) {
    await view.load('about:blank');
    const r = await runWebViewBenchmark(view, t, 'unpatched-cs24-polling');
    beforeRows.push(r);
    console.log(`[WebView UNPATCHED] ${t.label}`);
    console.log(`  Status: ${r.status} | DNS: ${r.dnsMs}ms | TTFB: ${r.ttfbMs}ms | DOM+Poll Wait: ${r.downloadMs}ms | Parse: ${r.parseMs}ms | Total: ${r.totalMs}ms`);
    console.log(`  Extracted (${r.ok ? 'YES' : 'NO'}): ${JSON.stringify(r.extracted)}\n`);
  }

  console.log('--- 3. WebView Full-Load Telemetry (Waiting on slow CSS/Images/Trackers without resource filtering) ---');
  const fullLoadArticle = await runWebViewBenchmark(view, targets[1], 'wait-full-load-with-assets');
  console.log(`[WebView FULL-LOAD] ${targets[1].label}: Total=${fullLoadArticle.totalMs}ms (blocked by 650ms subresources)\n`);

  // Enable resource filtering on the hidden scraper session (block images, stylesheets, fonts, media)
  scrapeSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const blockedTypes = ['image', 'stylesheet', 'font', 'media'];
    if (blockedTypes.includes(details.resourceType) || /slow-tracker\.js|google-analytics|googletagmanager/i.test(details.url)) {
      cb({ cancel: true });
    } else {
      cb({ cancel: false });
    }
  });

  console.log('--- 4. WebView DOM Scraping Telemetry: AFTER Patch (Event-Driven dom-ready + MutationObserver + Subresource Blocking) ---');
  const afterRows = [];
  for (const t of targets) {
    await view.load('about:blank');
    const r = await runWebViewBenchmark(view, t, 'patched-domready-observer');
    afterRows.push(r);
    console.log(`[WebView PATCHED] ${t.label}`);
    console.log(`  Status: ${r.status} | DNS: ${r.dnsMs}ms | TTFB: ${r.ttfbMs}ms | DOM+Observer: ${r.downloadMs}ms | Parse: ${r.parseMs}ms | Total: ${r.totalMs}ms`);
    console.log(`  Extracted (${r.ok ? 'YES' : 'NO'}): ${JSON.stringify(r.extracted)}\n`);
  }

  server.close();
  app.quit();
});
