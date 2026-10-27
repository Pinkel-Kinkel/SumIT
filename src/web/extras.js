// The Infinity Stones: a golden gauntlet with one stone for each thing that is connected. It is in the first-run guide (the stones fly in
// as things get connected) and in the settings (fixed at the side, it can be moved). With all six stones in it, a click is a snap that turns
// half of the app to dust. (After a restart everything is back, the gauntlet too.)
// Loaded before app.js; it only uses app.js's globals (S, h, helperMode ...) when called.

// x / y are the sockets in the gauntlet's drawing (200 x 240); r is the size of the stone.
const STONES = [
  { id: 'claude', stone: 'Mind Stone', name: 'Claude', color: '#facc15', x: 100, y: 133, big: true, ok: () => !!(S.ai && S.ai.claude && S.ai.claude.loggedIn) },
  { id: 'chatgpt', stone: 'Reality Stone', name: 'ChatGPT', color: '#ef4444', x: 84, y: 102, ok: () => helperMode('openai') !== '' },
  { id: 'gemini', stone: 'Space Stone', name: 'Gemini', color: '#38bdf8', x: 114, y: 102, ok: () => helperMode('gemini') !== '' },
  { id: 'cs24', stone: 'Power Stone', name: 'CS24', color: '#a855f7', x: 142, y: 108, ok: () => true },   // CS24 needs no sign-in: it is always there
  { id: 'moodle', stone: 'Time Stone', name: 'Moodle', color: '#22c55e', x: 162, y: 138, ok: () => S.moodle === 'ready' },
  { id: 'timetable', stone: 'Soul Stone', name: 'המערכת שלי', color: '#fb923c', x: 56, y: 108, ok: () => !!(S.timetable && (S.timetable.classes || []).length) }
];
// Only until the app restarts: an older version hid the gauntlet for good after one snap (snapSeen), which is ignored now.
let snapDone = false;
const snapped = () => snapDone;

window.stonesHook = (m) => {
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; if (typeof renderProviders === 'function') renderProviders(); }
  if (['aiStatus', 'moodle', 'settings', 'timetable'].includes(m.type)) setTimeout(() => {
    if (typeof S === 'undefined') return;
    if (S.view === 'settings') renderStoneField();
    updateWizGauntlet();
  }, 60);
};

// A cartoon gauntlet (flat gold, a thick brown outline), with a socket for every stone.
function gauntletSvg() {
  const finger = (x, y, rot, h) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-11" y="${-h}" width="22" height="${(h * 0.52).toFixed(1)}" rx="7"/><rect x="-11" y="${(-h * 0.48).toFixed(1)}" width="22" height="${(h * 0.5).toFixed(1)}" rx="7"/><path d="M-9 ${(-h * 0.46).toFixed(1)}h18" class="seam"/></g>`;
  return `<svg viewBox="0 0 200 240" class="gauntlet" aria-hidden="true">
    <defs><linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#f0b014"/></linearGradient></defs>
    <g fill="url(#gGold)" stroke="#7a4a08" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
      <path d="M50 148 L150 148 L176 216 Q100 236 24 216 Z"/>
      <path d="M40 200 Q100 218 160 200" fill="none" stroke-width="3"/>
      <path d="M86 156 L114 156 L120 196 L100 212 L80 196 Z" fill="#8c5a10" stroke-width="3"/>
      <path d="M94 168 L100 162 L106 168 M94 180 L100 174 L106 180 M94 192 L100 186 L106 192" fill="none" stroke="#f3c34a" stroke-width="2.4"/>
      ${finger(60, 104, -15, 62)}${finger(86, 100, -5, 74)}${finger(114, 100, 5, 72)}${finger(140, 104, 15, 58)}
      <path d="M46 100 Q42 142 54 156 L146 156 Q160 142 154 100 Z"/>
      <g transform="translate(156 126) rotate(50)"><rect x="-11" y="-42" width="22" height="44" rx="8"/><path d="M-11 -30 L-18 -50 L2 -62 L11 -46 Z"/></g>
    </g>
    ${STONES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="${s.big ? 20 : 10.5}" fill="#3a2406" stroke="#7a4a08" stroke-width="3"/>`).join('')}
  </svg>`;
}
const pos = (s) => `left:${(s.x / 2).toFixed(2)}%;top:${(s.y / 2.4).toFixed(2)}%`;

// Puts the stones into a gauntlet box: lit for what is connected, dashed for what is not. `fly` = the ones that just lit fly in from above.
function fillGauntlet(g, opts) {
  opts = opts || {};
  const all = STONES.every(s => s.ok());
  g.innerHTML = gauntletSvg();
  const tip = document.createElement('div'); tip.className = 'stone-tip'; g.append(tip);
  STONES.forEach(s => {
    const on = s.ok();
    const el = document.createElement('div');
    el.className = 'float-stone docked' + (on ? '' : ' off') + (s.big ? ' big' : '');
    el.style.cssText = `--c:${s.color};${pos(s)}`;
    el.onmouseenter = () => {
      tip.innerHTML = `<b>${s.stone}</b><small>${s.name}${on ? '' : ' · לא מחובר'}</small>`;
      tip.style.cssText = `--c:${s.color};left:${(s.x / 2).toFixed(2)}%;top:${((s.y - (s.big ? 26 : 18)) / 2.4).toFixed(2)}%`; tip.classList.add('on');
    };
    el.onmouseleave = () => tip.classList.remove('on');
    g.append(el);
    if (on && opts.fly && opts.fly.has(s.id)) el.animate([{ transform: 'translate(-50%, -50%) translate(0, -140px) scale(2.4)', opacity: 0 }, { opacity: 1, offset: .25 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.25,.8,.25,1)' });
  });
  g.classList.toggle('ready', all);
  if (all && !g.querySelector('.gf-hint') && opts.hint) { const hint = document.createElement('div'); hint.className = 'gf-hint'; hint.textContent = 'לחץ על הכפפה'; g.append(hint); }
  return all;
}

// ---------- The first-run guide: the stones fly into the gauntlet as things get connected ----------
let wizLit = new Set();
function updateWizGauntlet() {
  const w = document.getElementById('wizGauntlet'); if (!w || snapped()) return;
  const now = new Set(STONES.filter(s => s.ok()).map(s => s.id));
  const fresh = new Set([...now].filter(id => !wizLit.has(id)));
  fillGauntlet(w, { fly: fresh });
  wizLit = now;
}
window.updateWizGauntlet = updateWizGauntlet;
window.mountWizGauntlet = (art) => {
  if (snapped()) return;
  const w = document.createElement('div'); w.id = 'wizGauntlet'; w.className = 'wiz-gauntlet'; art.append(w);
  wizLit = new Set();
  updateWizGauntlet();
};

// ---------- The settings: the gauntlet is fixed at the side (it stays when the page is scrolled) and can be moved ----------
function renderStoneField() {
  const old = document.getElementById('stoneField'); if (old) old.remove();
  const main = document.getElementById('main'); if (!main || snapped() || (typeof S !== 'undefined' && S.view !== 'settings')) return;
  const field = document.createElement('div'); field.id = 'stoneField';
  const r = main.getBoundingClientRect();
  field.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  const g = document.createElement('div'); g.className = 'gf-gauntlet';
  let saved = null; try { saved = JSON.parse(localStorage.getItem('sumit.gauntletPos') || 'null'); } catch { }
  const gx = saved ? Math.min(Math.max(0, saved.x), r.width - 130) : r.width - 146, gy = saved ? Math.min(Math.max(0, saved.y), r.height - 160) : 90;
  g.style.cssText = `left:${gx}px;top:${gy}px`;
  const all = fillGauntlet(g, { hint: true });
  g.title = all ? 'Infinity Gauntlet' : 'צריך את כל אבני האינסוף';
  // Drag it anywhere; a click that did not move it is the snap (when all the stones are in).
  let drag = null;
  g.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, left: g.offsetLeft, top: g.offsetTop, moved: false }; g.setPointerCapture(e.pointerId); };
  g.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) { g.style.left = Math.min(Math.max(0, drag.left + dx), r.width - 130) + 'px'; g.style.top = Math.min(Math.max(0, drag.top + dy), r.height - 160) + 'px'; }
  };
  g.onpointerup = () => {
    const d = drag; drag = null; if (!d) return;
    if (d.moved) { try { localStorage.setItem('sumit.gauntletPos', JSON.stringify({ x: g.offsetLeft, y: g.offsetTop })); } catch { } }
    else if (g.classList.contains('ready')) snapNow();
  };
  field.append(g);
  main.append(field);
}
window.renderStoneField = renderStoneField;
addEventListener('resize', () => { if (typeof S !== 'undefined' && S.view === 'settings') renderStoneField(); });

// ---------- The snap ----------
function snapNow() {
  const field = document.getElementById('stoneField'); if (!field || document.body.classList.contains('snapping')) return;
  document.body.classList.add('snapping');
  field.querySelectorAll('.float-stone').forEach(s => s.classList.add('charged'));
  field.querySelector('.gf-gauntlet').classList.add('snap');
  const flash = document.createElement('div'); flash.className = 'snap-flash'; document.body.append(flash);
  setTimeout(() => flash.classList.add('on'), 900);
  setTimeout(() => {
    // Half of everything on the screen turns to dust.
    const sel = '.card, .setting, .nav-item, .provider, .stat-tile, .deadline, .task, .brand-art, .chip, h1, h2, h3, p, .hero, .logo, .avatar-img, .status-pill, .theme-toggle';
    const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null && !e.closest('#stoneField') && !e.closest('.snap-flash'));
    els.forEach(e => { if (Math.random() < 0.5) {
      e.style.setProperty('--dx', (40 + Math.random() * 140) + 'px'); e.style.setProperty('--dy', (-60 - Math.random() * 120) + 'px');
      e.style.setProperty('--rot', (Math.random() * 40 - 20) + 'deg'); e.style.setProperty('--delay', (Math.random() * 1.6) + 's');
      e.classList.add('dusted');
    } });
    document.body.classList.add('snapped');   // the character turns sad and fades away
    flash.classList.remove('on');
    field.remove();
    snapDone = true;
    send({ type: 'snapDone' });
  }, 1700);
}
window.snapNow = snapNow;
