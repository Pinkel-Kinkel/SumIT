'use strict';
// Preload for the site / viewer WebView.
// Exposes window.chrome.webview so summary-select.js and summary pages can send messages to the host:
//   window.chrome.webview.postMessage({ type: 'summarySelection', ... });

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('sumit-site-message', (_e, data) => {
  const ev = { data };
  for (const fn of Array.from(listeners)) {
    try { fn(ev); } catch (err) { console.error(err); }
  }
});

const bridge = {
  postMessage(msg) {
    ipcRenderer.send('sumit-site-message', msg);
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
