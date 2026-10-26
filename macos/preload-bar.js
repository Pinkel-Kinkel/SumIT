'use strict';
// Preload for the top login bar shown above Moodle / Zoom sign-in views.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sumitBar', {
  back() {
    ipcRenderer.send('sumit-loginbar-back');
  },
});
