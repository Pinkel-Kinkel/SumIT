// The pomodoro timer in the sidebar (the timer itself is pomodoro.js). It stays visible on every screen, also while a summary
// or a site is open. The state is kept in localStorage, so a reload of the page does not lose a running round.
const POMO_KEY = 'sumit-pomodoro';
const POMO_PHASE = { focus: 'ריכוז', short: 'הפסקה קצרה', long: 'הפסקה ארוכה' };
let pomo = { cfg: Pomodoro.config(null), state: Pomodoro.initial() };
let pomoInterval = null, pomoAudio = null, pomoIcon = '', pomoEndedTimer = null;

function pomoLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(POMO_KEY) || 'null');
    if (o && typeof o === 'object') { pomo.cfg = Pomodoro.config(o.cfg); pomo.state = Pomodoro.sanitize(o.state, pomo.cfg); }
  } catch { }
}
function pomoSave() { try { localStorage.setItem(POMO_KEY, JSON.stringify(pomo)); } catch { } }

function pomoBuild() {
  const el = $('pomo'); if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  el.innerHTML = `<button class="theme-toggle pomo-idle" data-act="toggle" title="התחל סבב ריכוז"><span data-ic="clock"></span><span class="nav-text">פומודורו</span><small class="pomo-preset nav-text" dir="ltr"></small></button>
    <div class="pomo-run" hidden>
      <div class="pomo-ring" data-act="expand" role="button" tabindex="0"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="bar" cx="22" cy="22" r="19" pathLength="100"/></svg><b class="pomo-time" dir="ltr"></b></div>
      <div class="pomo-info"><b class="pomo-phase"></b><small class="pomo-label" dir="auto"></small></div>
      <div class="pomo-btns"><button data-act="toggle" class="pomo-toggle"></button><button data-act="skip" title="דלג לשלב הבא" aria-label="דלג לשלב הבא"><span data-ic="skip"></span></button><button data-act="reset" title="אפס את הטיימר" aria-label="אפס את הטיימר"><span data-ic="reset"></span></button><button data-act="cfg" title="הגדרות הטיימר" aria-label="הגדרות הטיימר"><span data-ic="settings"></span></button></div>
    </div>`;
  icons(el);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) pomoAct(b.dataset.act); });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pomo-ring')) { e.preventDefault(); pomoAct('expand'); } });
}

function pomoRender() {
  const el = $('pomo'); if (!el) return;
  pomoBuild();
  const { state: s, cfg } = pomo, now = Date.now();
  const idle = s.phase === 'idle';
  el.querySelector('.pomo-idle').hidden = !idle;
  el.querySelector('.pomo-run').hidden = idle;
  el.querySelector('.pomo-preset').textContent = cfg.focus + '/' + cfg.short;
  el.dataset.phase = idle ? 'idle' : s.phase;
  if (idle) { pomoBigRender(); return; }
  const left = Pomodoro.remaining(s, cfg, now);
  el.dataset.running = s.running ? '1' : '0';
  el.dataset.last = s.running && left <= 10000 ? '1' : '0';
  el.querySelector('.pomo-ring').style.setProperty('--p', String(Math.round(Pomodoro.progress(s, cfg, now) * 1000) / 10));
  el.querySelector('.pomo-time').textContent = Pomodoro.fmt(left);
  el.querySelector('.pomo-phase').textContent = POMO_PHASE[s.phase] + (s.phase === 'focus' ? ` ${s.round}/${cfg.rounds}` : '');
  el.querySelector('.pomo-label').textContent = s.label || (s.running ? '' : 'לחץ התחל כשאתה מוכן');
  const icon = s.running ? 'pause' : 'play';
  const tog = el.querySelector('.pomo-toggle');
  if (icon !== pomoIcon) {
    pomoIcon = icon; tog.innerHTML = `<span data-ic="${icon}"></span>`; icons(tog);
    tog.classList.remove('swap'); void tog.offsetWidth; tog.classList.add('swap');
  }
  const text = (POMO_PHASE[s.phase]) + ' ' + Pomodoro.fmt(left) + (s.running ? '' : ' (מושהה)');
  el.querySelector('.pomo-ring').title = 'הגדל את השעון'; el.querySelector('.pomo-ring').setAttribute('aria-label', text + ' - הגדל את השעון');
  tog.title = tog.ariaLabel = pomoToggleLabel(s, left);
  pomoBigRender();
}

function pomoToggleLabel(s, left) {
  return s.running ? 'השהה' : (s.phase === 'focus' && left === Pomodoro.durationMs('focus', pomo.cfg) ? 'התחל ריכוז' : 'המשך');
}

// The enlarged clock: a click on the ring in the sidebar opens it, so the time can be read from across the desk.
function pomoBig() {
  if ($('pomoBig') || pomo.state.phase === 'idle') return;
  const dialog = h(`<dialog class="pomo-big" id="pomoBig" dir="rtl" aria-label="טיימר פומודורו"><div class="pomo-big-body" data-phase="">
    <b class="pomo-big-phase"></b><small class="pomo-big-label" dir="auto"></small><div class="pomo-dots" aria-hidden="true"></div>
    <div class="pomo-big-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="bar" cx="22" cy="22" r="19" pathLength="100"/></svg><b class="pomo-big-time" dir="ltr" aria-live="off"></b></div>
    <small class="pomo-big-next"></small>
    <div class="pomo-big-btns"><button type="button" data-act="toggle" class="primary pomo-big-toggle"></button><button type="button" data-act="skip" class="ghost">דלג לשלב הבא</button><button type="button" data-act="reset" class="ghost">אפס</button><button type="button" data-close class="ghost">סגור</button></div>
  </div></dialog>`);
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) { dialog.close(); return; }
    const b = e.target.closest('[data-act]'); if (b) pomoAct(b.dataset.act);
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  pomoBigRender();
}

function pomoBigRender() {
  const d = $('pomoBig'); if (!d) return;
  const { state: s, cfg } = pomo;
  if (s.phase === 'idle') { d.close(); return; }
  const left = Pomodoro.remaining(s, cfg, Date.now());
  const body = d.querySelector('.pomo-big-body');
  body.dataset.phase = s.phase; body.dataset.running = s.running ? '1' : '0'; body.dataset.last = s.running && left <= 10000 ? '1' : '0';
  d.querySelector('.pomo-big-ring').style.setProperty('--p', String(Math.round(Pomodoro.progress(s, cfg, Date.now()) * 1000) / 10));
  d.querySelector('.pomo-big-time').textContent = Pomodoro.fmt(left);
  d.querySelector('.pomo-big-phase').textContent = POMO_PHASE[s.phase] + (s.phase === 'focus' ? ` ${s.round}/${cfg.rounds}` : '');
  d.querySelector('.pomo-big-label').textContent = s.label || '';
  d.querySelector('.pomo-big-toggle').textContent = pomoToggleLabel(s, left);
  // The rounds of this cycle as dots, and what comes after this phase.
  const dots = d.querySelector('.pomo-dots'); dots.textContent = '';
  for (let i = 1; i <= cfg.rounds; i++) { const x = document.createElement('i'); x.className = i < s.round || (i === s.round && s.phase !== 'focus') ? 'done' : i === s.round ? 'now' : ''; dots.append(x); }
  const longNext = s.round % cfg.rounds === 0;
  d.querySelector('.pomo-big-next').textContent = s.phase === 'focus' ? `אחרי זה: הפסקה של ${longNext ? cfg.long : cfg.short} דקות` : `אחרי זה: סבב ריכוז של ${cfg.focus} דקות`;
}

// The alert of the system for the moment the phase ends (macOS; the host ignores it elsewhere).
function pomoAlert() {
  const { state: s, cfg } = pomo;
  if (!s.running || !cfg.notify) { send({ type: 'pomodoroAlert', cancel: true }); return; }
  const longNext = s.phase === 'focus' && s.round % cfg.rounds === 0;
  send({ type: 'pomodoroAlert', endsAt: s.endsAt,
    title: s.phase === 'focus' ? 'הריכוז הסתיים' : 'ההפסקה הסתיימה',
    body: s.phase === 'focus' ? `זמן להפסקה של ${longNext ? cfg.long : cfg.short} דקות.` : 'מוכן לסבב הבא?' });
}

// The sounds. Each style has two melodies, so the ear knows without looking: the end of a focus round (a falling, calming phrase:
// rest now) and the end of a break (a rising, brighter one: back to work). `volume` is 10 to 100.
const POMO_NOTES = {
  bell: { type: 'sine', len: .9, focus: [[784, 0], [659, .22], [523, .44]], back: [[523, 0], [659, .16], [784, .32], [1047, .48]] },
  soft: { type: 'triangle', len: .7, focus: [[587, 0], [440, .3]], back: [[440, 0], [587, .3]] },
  beep: { type: 'square', len: .16, focus: [[880, 0], [880, .24], [660, .48]], back: [[660, 0], [880, .2], [880, .4], [1175, .6]] },
};
function pomoAudioReady() {
  try {
    pomoAudio = pomoAudio || new (window.AudioContext || window.webkitAudioContext)();
    if (pomoAudio.state === 'suspended') pomoAudio.resume();
    return pomoAudio;
  } catch { return null; }
}
// A browser starts audio only after the student has touched the page once, so the first touch prepares it for the end of a round.
['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, () => pomoAudioReady(), { once: true, capture: true }));

function pomoChime(phase, kind, volume) {
  const ac = pomoAudioReady(); if (!ac) return;
  try {
    const n = POMO_NOTES[kind] || POMO_NOTES.bell, notes = phase === 'focus' ? n.focus : n.back;
    const peak = (n.type === 'square' ? .09 : .22) * (Math.min(100, Math.max(10, volume || 60)) / 100) * 1.6;
    const t = ac.currentTime + .03;
    notes.forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = n.type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(peak, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + n.len);
      o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + n.len + .05);
    });
  } catch { }
}

function pomoEnded(ev) {
  if (ev.late > 600000) return;   // it ended long ago (the app was closed): nothing to announce
  const { state: s, cfg } = pomo;
  if (ev.late < 60000 && cfg.sound) pomoChime(ev.phase, cfg.soundKind, cfg.volume);
  const el = $('pomo');
  if (el) { el.classList.add('ended'); clearTimeout(pomoEndedTimer); pomoEndedTimer = setTimeout(() => el.classList.remove('ended'), 2400); }
  const text = ev.phase === 'focus'
    ? (s.running ? `הריכוז הסתיים. הפסקה של ${Math.round(Pomodoro.durationMs(s.phase, cfg) / 60000)} דקות התחילה.` : 'הריכוז הסתיים. אפשר להתחיל הפסקה.')
    : 'ההפסקה הסתיימה. מוכן לסבב הבא?';
  const opts = { ms: 12000 };
  if (!s.running) { opts.action = ev.phase === 'focus' ? 'התחל הפסקה' : 'התחל ריכוז'; opts.onAction = () => pomoAct('toggle'); }
  toast(text, opts);
}

function pomoTick() {
  const r = Pomodoro.tick(pomo.state, pomo.cfg, Date.now());
  if (r.state !== pomo.state) {
    pomo.state = r.state; pomoSave();
    if (r.event) pomoEnded(r.event);
    pomoAlert(); pomoLoop();
  }
  pomoRender();
}

// One tick a second while a round is running; nothing while it is paused or idle.
function pomoLoop() {
  clearInterval(pomoInterval); pomoInterval = null;
  if (pomo.state.running) pomoInterval = setInterval(pomoTick, 1000);
}

function pomoApply(state) { pomo.state = state; pomoSave(); pomoAlert(); pomoLoop(); pomoRender(); }

function pomoAct(act) {
  const s = pomo.state, now = Date.now();
  if (act === 'toggle') pomoApply(s.phase === 'idle' ? Pomodoro.start(s, pomo.cfg, now) : s.running ? Pomodoro.pause(s, now) : Pomodoro.resume(s, now));
  else if (act === 'skip') pomoApply(Pomodoro.skip(s, pomo.cfg, now));
  else if (act === 'reset') pomoApply(Pomodoro.reset());
  else if (act === 'cfg') pomoSettings();
  else if (act === 'expand') pomoBig();
}

// A focus round for something the student is about to work on (the "⏱" button of a task in "what to do today").
function startPomodoroFor(label) {
  const s = pomo.state, now = Date.now();
  if (s.phase === 'focus' && s.running) { pomoApply(Object.assign({}, s, { label: String(label || '').slice(0, 120) })); toast('התווית של הטיימר עודכנה'); return; }
  // During a break, the next focus round starts at once (the break is skipped).
  const from = s.phase === 'short' || s.phase === 'long' ? Pomodoro.skip(s, pomo.cfg, now) : s;
  pomoApply(Pomodoro.start(from, pomo.cfg, now, label));
}

function pomoSettings() {
  const c = pomo.cfg;
  const opt = (v, label) => `<option value="${v}"${v === c.preset ? ' selected' : ''}>${label}</option>`;
  const num = (name, label, min, max) => `<label>${label}<input type="number" data-n="${name}" min="${min}" max="${max}" value="${c[name]}" class="ltr"></label>`;
  const check = (name, label) => `<label class="pomo-check"><input type="checkbox" data-c="${name}"${c[name] ? ' checked' : ''}><span>${label}</span></label>`;
  const dialog = h(`<dialog class="summary-options" dir="rtl" aria-labelledby="pomoTitle"><form method="dialog">
    <h2 id="pomoTitle">הגדרות הטיימר</h2>
    <label>תבנית<select data-preset>${opt('classic', 'קלאסי: 25 דקות ריכוז, 5 הפסקה')}${opt('deep', 'עמוק: 50 דקות ריכוז, 10 הפסקה')}${opt('quick', 'קצר: 15 דקות ריכוז, 3 הפסקה')}${opt('custom', 'מותאם אישית')}</select></label>
    <div class="row wrap pomo-custom" data-custom>${num('focus', 'ריכוז (דקות)', 1, 120)}${num('short', 'הפסקה קצרה', 1, 60)}${num('long', 'הפסקה ארוכה', 1, 90)}${num('rounds', 'סבבים עד הארוכה', 2, 8)}</div>
    <div class="pomo-sound row wrap"><label>צליל<select data-kind>${[['bell', 'פעמון'], ['soft', 'עדין'], ['beep', 'צפצוף']].map(([v, l]) => `<option value="${v}"${v === c.soundKind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>עוצמה<input type="range" data-volume min="10" max="100" step="5" value="${c.volume}"></label>
      <div class="row"><button type="button" class="ghost small" data-try="focus">נסה: סוף ריכוז</button><button type="button" class="ghost small" data-try="short">נסה: סוף הפסקה</button></div></div>
    <div class="pomo-checks">${check('auto', 'להתחיל הפסקה אוטומטית אחרי ריכוז')}${check('sound', 'צליל בסיום')}${check('notify', 'התראת מערכת כשהחלון ברקע')}</div>
    <div class="row"><div class="grow"></div><button type="submit" class="primary">שמור</button><button type="button" class="ghost" data-cancel>ביטול</button></div>
  </form></dialog>`);
  document.body.append(dialog);
  const sel = dialog.querySelector('[data-preset]'), custom = dialog.querySelector('[data-custom]');
  const sync = () => { custom.hidden = sel.value !== 'custom'; };
  sel.onchange = sync; sync();
  dialog.querySelectorAll('[data-try]').forEach(b => { b.onclick = () => pomoChime(b.dataset.try === 'focus' ? 'focus' : 'short', dialog.querySelector('[data-kind]').value, Number(dialog.querySelector('[data-volume]').value)); });
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const next = { preset: sel.value };
    dialog.querySelectorAll('[data-n]').forEach(i => { next[i.dataset.n] = i.value; });
    dialog.querySelectorAll('[data-c]').forEach(i => { next[i.dataset.c] = i.checked; });
    next.soundKind = dialog.querySelector('[data-kind]').value; next.volume = dialog.querySelector('[data-volume]').value;
    pomo.cfg = Pomodoro.config(next); pomoSave(); pomoAlert(); pomoRender(); dialog.close();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

pomoLoad();
pomoBuild();
pomoTick();
pomoLoop();
document.addEventListener('visibilitychange', () => { if (!document.hidden) pomoTick(); });
window.addEventListener('focus', pomoTick);
