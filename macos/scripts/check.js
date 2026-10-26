'use strict';
// Syntax and module integrity check for the macOS Electron port.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { listFiles } = require('../lib/util');

const root = path.resolve(__dirname, '..');
const jsFiles = [
  path.join(root, 'main.js'),
  path.join(root, 'preload-ui.js'),
  path.join(root, 'preload-bar.js'),
  ...listFiles(path.join(root, 'lib'), true).filter(f => f.endsWith('.js')),
];

for (const file of jsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(code, { filename: file });
  } catch (err) {
    console.error('Syntax error in', file, err);
    process.exit(1);
  }
}

const { Host } = require('../lib/host');
if (Host.modules.length !== 20) {
  console.error(`Expected 20 Host modules, loaded ${Host.modules.length}`);
  process.exit(1);
}

console.log(`CHECK OK: ${jsFiles.length} JS files syntax-checked, ${Host.modules.length} Host mixin modules loaded cleanly.`);
