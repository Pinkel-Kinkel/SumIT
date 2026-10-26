'use strict';
// Preload for the main UI WebView (https://app.local/ui.html).
// Exposes window.chrome.webview so src/web/app.js works without any changes:
//   host = window.chrome && window.chrome.webview;
//   host.postMessage(m);
//   host.addEventListener('message', e => onMessage(e.data));

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('sumit-host-message', (_e, data) => {
  const ev = { data };
  for (const fn of Array.from(listeners)) {
    try { fn(ev); } catch (err) { console.error(err); }
  }
});

const bridge = {
  postMessage(msg) {
    ipcRenderer.send('sumit-ui-message', msg);
  },
  addEventListener(type, fn) {
    if (type === 'message' && typeof fn === 'function') listeners.add(fn);
  },
  removeEventListener(type, fn) {
    if (type === 'message') listeners.delete(fn);
  },
};

contextBridge.exposeInMainWorld('sumitBridge', bridge);
try {
  contextBridge.exposeInMainWorld('chrome', { webview: bridge });
} catch { }
