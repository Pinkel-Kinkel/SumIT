// A study page as a small book: the pages are listed on the right (overview, summary, homework); the homework is grouped by question,
// questions that are not for this lecture are set apart, and a "not yet" note lives only on the homework page.
(function () {
  var NAMES = { over: 'מה חשוב לדעת', sum: 'סיכום לעיון', hw: 'שיעורי בית: מתחילים כאן' };
  var ICONS = { over: '🎯', sum: '📖', hw: '✏️' };
  var LONG = { over: 'סקירה: מה חובה לדעת', sum: 'הסיכום', hw: 'שיעורי בית' };


  // Light or dark, as the student likes (the choice is remembered on this PC); without a choice the page follows Windows.
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
  try { var saved = localStorage.getItem('sumit-study-theme'); if (saved === 'dark' || saved === 'light') applyTheme(saved); } catch (e) { }
  function themeButton(parent) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'booktheme' + (parent ? '' : ' floating');
    function label() { b.textContent = currentTheme() === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה'; }
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
    var order = ['hw', 'over', 'sum'].filter(function (n) { return g[n].length > 0 || (n === 'hw' && notyet.length); });
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
      var h = document.createElement('h1'); h.className = 'bookpage-title print-only'; h.textContent = ICONS[n] + ' ' + LONG[n]; s.appendChild(h);
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
      b.innerHTML = '<span class="bn">' + (ix + 1) + '</span><span class="bt">' + ICONS[n] + ' ' + NAMES[n] + '</span>';
      b.onclick = function () { restoreQuestion(); show(n, true); };
      side.appendChild(b);
    });

    themeButton(side);

    // Bottom of each page: the way to the next one.
    order.forEach(function (n, ix) {
      if (ix >= order.length - 1) return;
      var nav = document.createElement('div'); nav.className = 'pagenav';
      var next = document.createElement('button'); next.type = 'button'; next.textContent = 'לעמוד הבא: ' + ICONS[order[ix + 1]] + ' ' + NAMES[order[ix + 1]] + ' ←';
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
      var t = (d.querySelector('summary') || d).textContent || '', m = /שאלה\s*(\d+(?:\.\d+)*)/.exec(t);
      if (!m) return;
      any = true;
      var n = m[1], gr = groups[n];
      if (!gr) {
        gr = document.createElement('section'); gr.className = 'qgroup'; gr.dataset.question = n;
        var h = document.createElement('h3'); h.className = 'qghead'; h.textContent = 'שאלה ' + n;

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

  function start() { build(); if (!document.querySelector('.booktheme') && document.body) themeButton(null); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
