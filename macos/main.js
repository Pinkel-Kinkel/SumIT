'use strict';
// Entry point for the SumIT macOS Electron application.

const { app, protocol } = require('electron');
const dns = require('dns');
const platform = require('./lib/platform');

// Prefer IPv4 first on macOS to avoid IPv6 AAAA timeout fallback delays on campus/ISP networks.
try { dns.setDefaultResultOrder('ipv4first'); } catch { }

// Register https://app.local privileges before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'https',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

app.setName('SumIT');

let host = null;

app.whenReady().then(async () => {
  platform.extendPath();
  await platform.importLoginShellPath();
  const { Host } = require('./lib/host');
  host = new Host(process.argv.slice(1));
  await host.start();
});

app.on('window-all-closed', () => {
  app.quit();
});
