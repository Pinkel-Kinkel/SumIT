// A study page as a small book: the pages are listed on the right (overview, summary, homework); the homework is grouped by question,
// questions that are not for this lecture are set apart, and a "not yet" note lives only on the homework page.
(function () {
  var NAMES = { over: 'סקירה', sum: 'הסיכום', hw: 'שיעורי בית' };
  var ICONS = { over: '', sum: '', hw: '' };
  var LONG = { over: 'סקירה: מה חובה לדעת', sum: 'הסיכום', hw: 'שיעורי בית' };


  // Light or dark, as the student likes (the choice is remembered on this PC); without a choice the page follows Windows.
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); try { fixContrast(); } catch (e) { } }

  // A page written with its own light boxes (a pale background set in the page itself) becomes light text on a light box in the dark
  // theme. In the dark theme the text inside such a box is darkened (and a figure drawn on a white sheet gets dark ink); in the
  // light theme everything goes back to what the page says.
  function rgbOf(c) { var m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; }
  function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function lightBackground(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var bg = rgbOf(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0.6) return lum(bg) > 0.72;
      if (n.classList && n.classList.contains('wrap')) break;
    }
    return false;
  }
  // Remembers what the page itself said inline, so the light theme can put it back exactly.
  function setInk(el, prop, val) {
    var saved = {}; try { saved = JSON.parse(el.getAttribute('data-ink') || '{}'); } catch (e) { saved = {}; }
    if (!(prop in saved)) saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.setAttribute('data-ink', JSON.stringify(saved));
    el.style.setProperty(prop, val, 'important');
  }
  function clearInk(el) {
    var saved = {}; try { saved = JSON.parse(el.getAttribute('data-ink') || '{}'); } catch (e) { saved = {}; }
    for (var prop in saved) { el.style.removeProperty(prop); if (saved[prop][0]) el.style.setProperty(prop, saved[prop][0], saved[prop][1]); }
    el.removeAttribute('data-ink');
  }
  function fixContrast() {
    var root = document.querySelector('.wrap'); if (!root) return;
    var all = root.querySelectorAll('*'), i, el, cs;
    for (i = 0; i < all.length; i++) if (all[i].hasAttribute('data-ink')) clearInk(all[i]);
    if (currentTheme() !== 'dark') return;
    // 1. A box the page painted light becomes a dark box (the page's own light colours would glare on the dark page).
    for (i = 0; i < all.length; i++) {
      el = all[i]; if (/^(script|style)$/i.test(el.tagName) || el instanceof SVGElement) continue;
      var bg = rgbOf(getComputedStyle(el).backgroundColor);
      if (bg && bg[3] > 0.6 && lum(bg) > 0.72) setInk(el, 'background-color', '#1c2538');
    }
    // 2. Text the page coloured dark now sits on a dark box or the dark page: it turns light.
    for (i = 0; i < all.length; i++) {
      el = all[i]; if (/^(script|style)$/i.test(el.tagName) || el instanceof SVGElement) continue;
      var col = rgbOf(getComputedStyle(el).color);
      if (col && lum(col) < 0.45 && !lightBackground(el)) setInk(el, 'color', '#ecebe6');
    }
    // 3. Figures: a white sheet disappears, and ink that is almost black turns light.
    var svgs = root.querySelectorAll('svg');
    for (i = 0; i < svgs.length; i++) {
      var s = svgs[i], vb = (s.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number), parts = s.querySelectorAll('*'), k;
      for (k = 0; k < parts.length; k++) {
        var part = parts[k]; cs = getComputedStyle(part);
        var f = cs.fill && cs.fill !== 'none' ? rgbOf(cs.fill) : null, st = cs.stroke && cs.stroke !== 'none' ? rgbOf(cs.stroke) : null;
        if (f && lum(f) > 0.9 && part.tagName.toLowerCase() === 'rect' && vb.length === 4 && (parseFloat(part.getAttribute('width')) || 0) >= vb[2] * 0.85) setInk(part, 'fill', 'transparent');
        else if (f && lum(f) < 0.2 && f[3] > 0.5) setInk(part, 'fill', '#e6e9f2');
        if (st && lum(st) < 0.2 && st[3] > 0.5) setInk(part, 'stroke', '#cbd2e0');
      }
    }
  }
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { fixContrast(); }); } catch (e) { } }
  try { var saved = localStorage.getItem('sumit-study-theme'); if (saved === 'dark' || saved === 'light') applyTheme(saved); } catch (e) { }
  function themeButton(parent) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'booktheme' + (parent ? '' : ' floating');
    function label() { b.textContent = currentTheme() === 'dark' ? 'מצב בהיר' : 'מצב כהה'; }
    b.onclick = function () { var n = currentTheme() === 'dark' ? 'light' : 'dark'; applyTheme(n); try { localStorage.setItem('sumit-study-theme', n); } catch (e) { } label(); };
    label(); (parent || document.body).appendChild(b); return b;
  }
  function kindOf(h) {
    var id = h.id || '', t = h.textContent || '';
    if (/^use/.test(id) || /שיעורי בית|שימוש בתרגילים|תרגילים|פתרונות/.test(t)) return 'hw';
    if (/^(must|cheat)$/.test(id) || /חובה|לדלג|קבועים|יחידות/.test(t)) return 'over';
    return 'sum';
  }
  function isNotYet(el) {
    if (!el.classList) return false;
    if (el.tagName === 'DETAILS' || el.tagName === 'H2' || el.querySelector('details')) return false;
    if (el.classList.contains('notyet')) return true;
    return /לא לעשות עדיין/.test((el.textContent || '').slice(0, 200)) && /callout|alert|note|warn|err/.test(el.className || '');
  }
  // Only a direct deferral statement identifies a deferred question. Other numbers in its explanation are not scope.
  function deferredNumbers(el) {
    var out = {}, explicit = el.getAttribute('data-deferred-questions');
    if (explicit && /^\d+(?:\s*,\s*\d+)*$/.test(explicit)) { explicit.split(',').forEach(function(n){out[String(Number(n.trim()))]=true;}); return out; }
    var text = el.textContent || '', re = /שאלה\s*(\d+)\s*(?:\([^)]{0,100}\))?\s*[:–—-]?\s*(?:לא לעשות עדיין|נדחתה|לא להרצאה הזו)/g, m;
    while ((m = re.exec(text))) out[m[1]] = true;
    return out;
  }


  var EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{2B55}\u{FE0F}\u{200D}]/gu;
  function stripEmoji() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (t) {
      var p = t.parentNode; if (!p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName) || (p.closest && p.closest('.katex,.chev,svg'))) return;
      var v = t.nodeValue, c = v.replace(EMOJI, function (m) { return /[\u2713\u2714\u2717\u2718]/.test(m) ? m : ''; }).replace(/^\s{2,}/, ' ');
      if (c !== v) t.nodeValue = c;
    });
  }

  function build() {
    var wrap = document.querySelector('.wrap');
    if (!wrap || wrap.getAttribute('data-book')) return;
    var kids = Array.prototype.slice.call(wrap.children), first = -1, i;
    for (i = 0; i < kids.length; i++) if (kids[i].tagName === 'H2') { first = i; break; }
    if (first < 0) return;

    var g = { over: [], sum: [], hw: [] }, cur = 'sum', ended = false, notyet = [], lead = [];
    for (i = 0; i < first; i++) {
      var p = kids[i];
      if (p.tagName === 'HEADER' || p.tagName === 'NAV' || p.tagName === 'STYLE' || p.tagName === 'SCRIPT') continue;
      if (isNotYet(p)) notyet.push(p); else lead.push(p);
    }
    for (i = first; i < kids.length; i++) {
      var k = kids[i];
      if (k.tagName === 'FOOTER' || k.tagName === 'SCRIPT' || k.tagName === 'STYLE') ended = true;
      if (ended) continue;
      if (k.tagName === 'H2') cur = kindOf(k);
      if (isNotYet(k)) { notyet.push(k); continue; }
      g[cur].push(k);
    }
    var order = ['over', 'sum', 'hw'].filter(function (n) { return g[n].length > 0 || (n === 'hw' && notyet.length); });
    if (order.length < 2) { return; }
    if (notyet.length && order.indexOf('hw') < 0) { g.hw = []; order.push('hw'); }
    wrap.setAttribute('data-book', '1');

    var toc = wrap.querySelector('nav.toc');
    var grid = document.createElement('div'); grid.className = 'bookgrid';
    var side = document.createElement('aside'); side.className = 'booktabs';
    var main = document.createElement('div'); main.className = 'bookmain';
    var reading = document.createElement('div'); reading.className = 'bookreading';
    var pin = document.createElement('aside'); pin.className = 'book-question-pin'; pin.hidden = true;
    pin.setAttribute('aria-label', 'השאלה לצד ההסבר');
    reading.appendChild(pin); reading.appendChild(main);
    grid.appendChild(side); grid.appendChild(reading);
    var controls = document.createElement('div'); controls.className = 'book-controls';
    var menuToggle = document.createElement('button'); menuToggle.type = 'button';
    menuToggle.setAttribute('aria-controls', 'sumit-book-sections'); side.id = 'sumit-book-sections';
    controls.appendChild(menuToggle); wrap.insertBefore(controls, kids[first]);
    var collapsed = false, pinned = null, printQuestion = null;
    function collapseSections(value) {
      collapsed = value; grid.classList.toggle('tabs-collapsed', value); side.hidden = value;
      menuToggle.textContent = value ? 'הצג סעיפים ☰' : 'הסתר סעיפים ☰';
      menuToggle.setAttribute('aria-expanded', String(!value));
    }
    menuToggle.onclick = function () { collapseSections(!collapsed); if (pinned) pinned.previousCollapsed = collapsed; };
    collapseSections(false);
    function restoreQuestion() {
      if (!pinned) return;
      var old = pinned; pinned = null;
      old.placeholder.parentNode.replaceChild(old.question, old.placeholder);
      pin.replaceChildren(); pin.hidden = true;
      reading.classList.remove('with-question'); wrap.classList.remove('has-question');
      collapseSections(old.previousCollapsed);
    }
    function pinQuestion(question) {
      if (pinned && pinned.question === question) return;
      restoreQuestion();
      var placeholder = document.createComment('question reading position');
      question.parentNode.insertBefore(placeholder, question);
      pinned = { question:question, placeholder:placeholder, previousCollapsed:collapsed };
      var head = document.createElement('div'); head.className = 'book-pin-head';
      var title = document.createElement('b'); title.textContent = 'השאלה שלך'; head.appendChild(title);
      var back = document.createElement('button'); back.type = 'button'; back.textContent = 'חזרה לתרגיל';
      back.onclick = function () { restoreQuestion(); show('hw', false); question.open = true; question.scrollIntoView({block:'start'}); };
      var close = document.createElement('button'); close.type = 'button'; close.textContent = 'סגור';
      close.onclick = restoreQuestion; head.appendChild(back); head.appendChild(close);
      pin.appendChild(head); pin.appendChild(question); question.open = true; pin.hidden = false;
      reading.classList.add('with-question'); wrap.classList.add('has-question'); collapseSections(true);
    }
    addEventListener('beforeprint', function () { printQuestion = pinned && pinned.question; restoreQuestion(); });
    addEventListener('afterprint', function () { if (printQuestion) pinQuestion(printQuestion); printQuestion = null; });
    wrap.insertBefore(grid, kids[first]);
    if (toc) main.appendChild(toc);

    var pages = {};
    order.forEach(function (n) {
      var s = document.createElement('section'); s.className = 'bookpage'; s.id = 'bp-' + n; main.appendChild(s); pages[n] = s;
      var h = document.createElement('h1'); h.className = 'bookpage-title print-only'; h.textContent = LONG[n]; s.appendChild(h);
    });
    lead.forEach(function (e) { (pages.over || pages.sum).appendChild(e); });
    order.forEach(function (n) { g[n].forEach(function (e) { pages[n].appendChild(e); }); });
    if (pages.hw && notyet.length) {
      var title = pages.hw.querySelector('.bookpage-title');
      notyet.slice().reverse().forEach(function (e) { e.classList.add('notyet'); pages.hw.insertBefore(e, title.nextSibling); });
    }
    // Tabs on the right, with a number: the student sees there are pages and where he is.
    var label = document.createElement('div'); label.className = 'booklabel'; label.textContent = 'עמודים'; side.appendChild(label);
    order.forEach(function (n, ix) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-p', n);
      b.innerHTML = '<span class="bn">' + (ix + 1) + '</span><span class="bt">' + NAMES[n] + '</span>';
      b.onclick = function () { restoreQuestion(); show(n, true); };
      side.appendChild(b);
    });

    themeButton(side);

    // Bottom of each page: the way to the next one.
    order.forEach(function (n, ix) {
      if (ix >= order.length - 1) return;
      var nav = document.createElement('div'); nav.className = 'pagenav';
      var next = document.createElement('button'); next.type = 'button'; next.textContent = 'לעמוד הבא: ' + NAMES[order[ix + 1]] + ' ←';
      next.onclick = function () { show(order[ix + 1], true); };
      nav.appendChild(next); pages[n].appendChild(nav);
    });

    if (pages.hw) groupQuestions(pages.hw, notyet);

    function pageOf(el) { var p = el.closest ? el.closest('.bookpage') : null; return p ? p.id.slice(3) : null; }
    function show(n, top) {
      order.forEach(function (x) { pages[x].classList.toggle('on', x === n); });
      Array.prototype.forEach.call(side.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-p') === n); });
      Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^="#"]'), function (a) {
        var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t ? pageOf(t) : null;
        a.style.display = (pg && pg !== n) ? 'none' : '';
      });
      if (top) { try { grid.scrollIntoView(); } catch (e) { } }
    }
    function goHash() {
      var id = decodeURIComponent(location.hash.slice(1)), t = id && document.getElementById(id), pg = t && pageOf(t);
      if (pg) { show(pg, false); if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView(); }
    }
    Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^="#"]'), function (a) {
      a.addEventListener('click', function (ev) {
        var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t && pageOf(t);
        if (pg) { ev.preventDefault(); show(pg, false); t.scrollIntoView(); }
      });
    });
    // A link inside the text to another page's section opens that page first.
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[href^="#"]') : null; if (!a || a.closest('nav.toc')) return;
      var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t && pageOf(t);
      if (pg) {
        ev.preventDefault();
        var question = a.closest('details.q');
        if (question && pg !== 'hw') pinQuestion(question);
        else if (pg === 'hw') restoreQuestion();
        show(pg, false);
        for (var parent = t; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        t.scrollIntoView({block:'start'});
      }
    });
    addEventListener('hashchange', goHash);
    show(order[0], false); goHash();
  }

  // The homework, question by question: one block for each, the parts (א, ב, ...) inside it. A question that is not for this lecture
  // (the lecturer said to skip it, or it needs what has not been taught yet) is set apart and says so.
  function groupQuestions(page, notyet) {
    var later = {};
    notyet.forEach(function (e) { var n = deferredNumbers(e); for (var k in n) later[k] = true; });
    var items = Array.prototype.slice.call(page.querySelectorAll('details.q')), groups = {}, any = false;
    items.forEach(function (d) {
      var t = (d.querySelector('summary') || d).textContent || '', m = /שאלה\s*(\d+(?:\.\d+)*)/.exec(t), named = d.getAttribute('data-group');
      if (!m && !named) return;
      any = true;
      var n = named || m[1], gr = groups[n];
      if (!gr) {
        gr = document.createElement('section'); gr.className = 'qgroup'; gr.dataset.question = n;
        var h = document.createElement('h3'); h.className = 'qghead'; h.textContent = named || ('שאלה ' + n);

        gr.appendChild(h); d.parentNode.insertBefore(gr, d); groups[n] = gr;
      }
      gr.appendChild(d);
    });
    Object.keys(groups).forEach(function(n) {
      var gr=groups[n], parts=Array.prototype.slice.call(gr.querySelectorAll('details.q'));
      // One deferred subpart must not mark the entire question as deferred.
      var allDeferred=parts.length && parts.every(function(d){return d.classList.contains('notyet')||d.dataset.homeworkStatus==='deferred';});
      if(later[n] || allDeferred) { gr.classList.add('later');var badge=document.createElement('span');badge.className='qbadge';badge.textContent='לא לעשות עדיין';gr.querySelector('.qghead').appendChild(badge); }
    });
  }

  // A formula in a table cell stays on one line; a table wider than the page scrolls sideways instead of breaking its formulas.
  function wrapTables() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.closest('.tablewrap, .sumit-tablewrap') || t.closest('.katex')) continue;
      var w = document.createElement('div'); w.className = 'sumit-tablewrap';
      t.parentNode.insertBefore(w, t); w.appendChild(t);
    }
  }
  function start() { stripEmoji(); try { wrapTables(); } catch (e) { } build(); try { fixContrast(); } catch (e) { } if (!document.querySelector('.booktheme') && document.body) themeButton(null); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
