'use strict';
// Port of src/SummaryBook.cs

const fs = require('fs');
const path = require('path');
const { fileExists, mkdirp, readText, writeText } = require('../util');
const platform = require('../platform');

module.exports = {
  methods: {
    AddBookLayout(page) {
      try {
        if (!fileExists(page)) return;
        const dir = path.join(path.dirname(page), '.sumit-math');
        mkdirp(dir);
        for (const f of ['study-book.js', 'study-book.css', 'study-diagrams.js']) {
          fs.copyFileSync(path.join(platform.WebDir, f), path.join(dir, f));
        }
        let html = readText(page);
        const orig = html;
        html = html.replace(/<style id="sumit-book">[\s\S]*?<\/style>/g, '');
        html = html.replace(/<script id="sumit-book-js">[\s\S]*?<\/script>/g, '');
        if (!html.includes('data-sumit-book')) {
          const tags = '<link rel="stylesheet" href=".sumit-math/study-book.css" data-sumit-book><script defer src=".sumit-math/study-book.js" data-sumit-book></script>';
          const h = html.toLowerCase().lastIndexOf('</head>');
          html = h >= 0 ? html.slice(0, h) + tags + html.slice(h) : tags + html;
        }
        if (!html.includes('data-sumit-diagrams')) {
          const diagrams = '<script defer src=".sumit-math/study-diagrams.js" data-sumit-diagrams></script>';
          const end = html.toLowerCase().lastIndexOf('</head>');
          html = end >= 0 ? html.slice(0, end) + diagrams + html.slice(end) : diagrams + html;
        }
        if (html !== orig) writeText(page, html);
      } catch { }
    },
  },
};
