'use strict';
// Port of src/StudyRendering.cs

const fs = require('fs');
const path = require('path');
const { fileExists, mkdirp, listFiles, readText, writeText } = require('../util');
const platform = require('../platform');

module.exports = {
  methods: {
    PrepareStudyPage(page) {
      if (!fileExists(page)) return;
      const dir = path.join(path.dirname(page), '.sumit-math');
      mkdirp(dir);
      const source = path.join(platform.WebDir, 'vendor', 'katex');
      for (const f of listFiles(source, true)) {
        const dest = path.join(dir, f.substring(source.length + 1));
        mkdirp(path.dirname(dest));
        try {
          if (!fileExists(dest) || fs.statSync(dest).size !== fs.statSync(f).size) fs.copyFileSync(f, dest);
        } catch { }
      }
      try { fs.copyFileSync(path.join(platform.WebDir, 'study-math.js'), path.join(dir, 'study-math.js')); } catch { }
      let html = readText(page);
      if (!/<!doctype\s+html/i.test(html)) html = '<!doctype html>\n' + html;
      html = html.replace(/<!-- sumit-render-start -->[\s\S]*?<!-- sumit-render-end -->/g, '');
      // Replace only KaTeX CDN resources, preserving the generated page's interactive behavior.
      html = html.replace(/<script\b[^>]*src\s*=\s*['"][^'"]*(?:katex|auto-render)[^'"]*['"][^>]*>\s*<\/script>/gi, '');
      html = html.replace(/<link\b[^>]*href\s*=\s*['"][^'"]*katex[^'"]*['"][^>]*>/gi, '');
      const resources = '<!-- sumit-render-start --><meta charset="utf-8"><link rel="stylesheet" href=".sumit-math/katex.min.css">'
        + '<style>html,body{direction:rtl}body{font-family:-apple-system,"SF Pro Text","Segoe UI",Arial,sans-serif}p,li,td,th{unicode-bidi:plaintext}.katex,.katex-display,.sumit-math{direction:ltr!important;unicode-bidi:isolate!important}.sumit-math{display:inline-block;max-width:100%}.katex-display{overflow-x:auto;overflow-y:hidden}.sumit-math-error{color:#b45309}code,pre{direction:ltr;unicode-bidi:isolate}</style>'
        + '<script defer src=".sumit-math/katex.min.js"></script><script defer src=".sumit-math/study-math.js"></script><!-- sumit-render-end -->';
      const head = html.toLowerCase().lastIndexOf('</head>');
      html = head >= 0 ? html.slice(0, head) + resources + html.slice(head) : resources + html;
      const temp = page + '.rendering';
      writeText(temp, html);
      fs.copyFileSync(temp, page);
      try { fs.unlinkSync(temp); } catch { }
      this.AddBookLayout(page);
    },
  },
};
