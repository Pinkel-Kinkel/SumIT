// Runs offline in generated study pages. Do not process code, scripts or already rendered math.
(() => {
  function sanitizeTex(tex) {
    if (!tex) return '';
    let s = tex.trim();
    // Normalize multiplication dots and bullets to \cdot
    s = s.replace(/[·•]/g, ' \\cdot ');
    // Fix prime following \vec: e.g. \vec p' -> \vec{p}'
    s = s.replace(/\\vec\s+([a-zA-Z])'/g, '\\vec{$1}\'');
    // Normalize unicode arrows and minus if typed literally
    s = s.replace(/→/g, ' \\to ').replace(/←/g, ' \\leftarrow ').replace(/−/g, '-');
    return s;
  }

  function render() {
    if (!window.katex || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const math = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let failures = 0;
    for (const node of nodes) {
      if (node.parentElement.closest('script,style,pre,code,textarea,.katex,.sumit-math')) continue;
      const value = node.nodeValue; math.lastIndex = 0; let match, last = 0, frag = document.createDocumentFragment(), found = false;
      while ((match = math.exec(value))) {
        found = true; frag.append(document.createTextNode(value.slice(last, match.index)));
        const el = document.createElement('span'); el.className = 'sumit-math'; el.dir = 'ltr';
        const rawTex = match[1] ?? match[2] ?? match[3] ?? match[4];
        const tex = sanitizeTex(rawTex);
        const isDisplay = match[1] != null || match[2] != null;
        try {
          katex.render(tex, el, { displayMode: isDisplay, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000 });
        } catch (_) {
          // Fallback with throwOnError: false to highlight issue without breaking layout
          try {
            katex.render(tex, el, { displayMode: isDisplay, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000 });
          } catch {
            el.textContent = match[0]; el.title = 'לא ניתן להציג את הנוסחה; מוצג המקור'; el.classList.add('sumit-math-error'); failures++;
          }
        }
        frag.append(el); last = math.lastIndex;
      }
      if (found) { frag.append(document.createTextNode(value.slice(last))); node.replaceWith(frag); }
    }
    document.documentElement.dataset.sumitMath = 'ready';
    document.documentElement.dataset.sumitMathErrors = String(failures);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
