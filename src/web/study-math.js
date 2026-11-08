// Runs offline in generated study pages. Do not process code, scripts or already rendered math.
(() => {
  // Coordinates and plain-text equations such as "P2 (110, 218)" or "Δx = 110 − 130 = −20" are left-to-right runs.
  // Inside a Hebrew paragraph the browser reorders them, so each run gets its own isolated direction.
  function isolateLtrRuns() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const run = /[A-Za-z0-9Δ(−][A-Za-z0-9Δ().,:=+\-−×÷\/^′' ]*[A-Za-z0-9Δ)]/g;
    for (const node of nodes) {
      const p = node.parentElement;
      if (!p || p.closest('script,style,pre,code,textarea,svg,.katex,.sumit-math,.sumit-ltr')) continue;
      const value = node.nodeValue; run.lastIndex = 0; let m, last = 0, frag = document.createDocumentFragment(), found = false;
      while ((m = run.exec(value))) {
        if (!/[(=,+−×÷\/]/.test(m[0]) || !/[0-9]/.test(m[0])) continue;
        found = true; frag.append(document.createTextNode(value.slice(last, m.index)));
        const el = document.createElement('span'); el.className = 'sumit-ltr'; el.dir = 'ltr'; el.style.unicodeBidi = 'isolate'; el.textContent = m[0];
        frag.append(el); last = run.lastIndex;
      }
      if (found) { frag.append(document.createTextNode(value.slice(last))); node.replaceWith(frag); }
    }
  }

  function render() {
    if (!window.katex || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const math = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let failures = 0;
    for (const node of nodes) {
      if (node.parentElement.closest('script,style,pre,code,textarea,.katex,.sumit-math')) continue;
      const value=node.nodeValue; math.lastIndex=0; let match,last=0,frag=document.createDocumentFragment(),found=false;
      while ((match=math.exec(value))) {
        found=true;frag.append(document.createTextNode(value.slice(last,match.index)));
        const el=document.createElement('span');el.className='sumit-math';el.dir='ltr';
        const tex=match[1]??match[2]??match[3]??match[4];
        try { katex.render(tex,el,{displayMode:match[1]!=null||match[2]!=null,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000}); }
        catch (_) { el.textContent=match[0];el.title='לא ניתן להציג את הנוסחה; מוצג המקור';el.classList.add('sumit-math-error');failures++; }
        // A unit written right after the formula ("(130, 205) m") belongs to it; left outside, it jumps to the wrong side in Hebrew text.
        if(match[1]==null&&match[2]==null){const u=/^[  ]?(?:m\/s²|m\/s\^2|m\/s|km\/h|cm|mm|km|kg|m|s|N|J|W|Hz|g)(?![A-Za-z0-9])/.exec(value.slice(math.lastIndex));
          if(u){el.append(document.createTextNode(u[0]));math.lastIndex+=u[0].length;}}
        frag.append(el);last=math.lastIndex;
      }
      if(found){frag.append(document.createTextNode(value.slice(last)));node.replaceWith(frag);}
    }
    isolateLtrRuns();
    document.documentElement.dataset.sumitMath='ready';
    document.documentElement.dataset.sumitMathErrors=String(failures);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
