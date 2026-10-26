'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEMO = new URLSearchParams(location.search).has('demo');
let host = null;
const send = (m) => { if(m.course && ['chat','chatCheck'].includes(m.type)) {const r=runtimeFor(m.course);r.chatBusy=r.chatBusy||{};r.chatBusy[m.scope||'course']=true;} return host && host.postMessage(m); };

const S = {
  settings: {}, moodle: 'checking', ai: null, courses: null, events: null, userName: '',
  course: null, sections: [], local: null, notability: null, open: new Set(), tab: 'lessons',
  chatBusy: false, chatHidden: true, view: 'home', site: 'moodle', jobs: new Map(), ready: { settings: false, ai: false }, theme: 'system'
};

// Runtime belongs to the course, not to whichever course happens to be visible.
const courseRuntime = new Map();
function runtimeFor(name) {
  if (!courseRuntime.has(name)) courseRuntime.set(name, { sections: new Map(), operations: new Map(), runs: new Map() });
  return courseRuntime.get(name);
}
function rememberCourseUi() {
  if (!S.course) return;
  Object.assign(runtimeFor(S.course.name), { tab:S.tab, open:new Set(S.open), chatLogs:S.chatLogs, chatScope:S.chatScope, pendingChat:S.pendingChat });
}
function rememberCourseEvent(m) {
  const parts = (m.key || '').split('|'), name = m.course || (['aiRun','aiLog'].includes(m.type) ? parts[1] : null);
  if (!name) return;
  const r = runtimeFor(name);
  if(m.type==='chatDone'){r.chatBusy=r.chatBusy||{};r.chatBusy[m.scope||'course']=false;}
  if(m.type==='chat' && S.course?.name!==name && m.role!=='tool'){r.chatLogs=r.chatLogs||{};const scope=m.scope||'course';(r.chatLogs[scope]=r.chatLogs[scope]||[]).push({role:m.role,text:m.text});}
  if (m.type === 'operationStatus') r.operations.set(m.operation, m.busy);
  if (m.type === 'courseStatus' || m.type === 'learnStatus') r.status = {...m};
  if (m.type === 'learnStatus') r.learning = m.busy;
  if (m.type === 'aiRun') r.runs.set(m.key, m.busy);
  const num = m.num ?? (parts[0] === 'sum' ? +parts[2] : null);
  if (num != null && ['sectionStatus','sectionProgress','aiRun','aiLog'].includes(m.type)) {
    const s = r.sections.get(num) || {}; r.sections.set(num,s);
    if (m.type === 'sectionStatus') Object.assign(s,{status:m.text,statusError:m.error,busy:m.busy});
    if (m.type === 'sectionProgress') Object.assign(s,{pct:m.pct>=100?null:m.pct,eta:m.eta,pctText:m.text});
    if (m.type === 'aiRun') {s.aiBusy=m.busy;if(!m.busy){s.busy=false;s.pct=null;}else s.logs=[];}
    if (m.type === 'aiLog') s.logs=[...(s.logs||[]),m.text].slice(-40);
  }
  if (m.type === 'courseLocal' && S.courses) {const c=S.courses.find(c=>c.name===name);if(c)c.local=m.local;}
}
function restoreCourseRuntime(render=false) {
  if (!S.course) return;
  const r=runtimeFor(S.course.name), running=k=>!!r.operations.get(k);
  S.infoBusy=running('syllabus')||running('info')||!!r.runs.get('info|'+S.course.name);
  S.examBusy=running('exam')||!!r.runs.get('exam|'+S.course.name);
  S.sections.forEach(s=>Object.assign(s,r.sections.get(s.num)||{}));
  $('learnAll').disabled=!!r.learning;
  const active=[...r.operations].filter(([,busy])=>busy).map(([op])=>({syllabus:'מסנכרן וקורא את הסילבוס...',info:'קורא את הסילבוס...',exams:'מוריד מבחנים ופתרונות...',exam:'מכין חומר למבחן...'}[op]||'עובד ברקע...'));
  const status=r.status;
  if(status && (status.busy || status.error || !active.length))courseStatus(status.text,status.busy,status.error,status.pct);
  else if(active.length)courseStatus(active.join(' · '),true,false);
  else courseStatus('',false,false);
  if(render) {
    renderLectures();
    if(S.tab==='info')renderInfo();if(S.tab==='exams')renderExams();
    S.sections.forEach(s=>{
      const log=document.querySelector(`.lecture[data-num="${s.num}"] .ai-log`);
      if(!log||!s.logs?.length)return;
      log.replaceChildren();log.classList.add('show');
      s.logs.forEach((text,i)=>{const line=document.createElement('div');line.className='phase '+(s.aiBusy&&i===s.logs.length-1?'now':'done');line.textContent=text;log.append(line);});
    });
  }
}

// ---------- Theme ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t) {
  if (t) S.theme = t;
  const dark = S.theme === 'dark' || (S.theme === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const icon = $('themeIcon'); if (icon) icon.innerHTML = dark ? IC.sun : IC.moon;
  const text = $('themeText'); if (text) text.textContent = dark ? 'מצב בהיר' : 'מצב כהה';
  const sel = $('themeSelect'); if (sel) sel.value = S.theme;
}
darkQuery.addEventListener('change', () => applyTheme());
applyTheme('system');

// ---------- Small helpers ----------
function icons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => { if (!el.dataset.done) { el.insertAdjacentHTML('afterbegin', IC[el.dataset.ic] || ''); el.dataset.done = 1; } });
}
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); icons(t.content); return t.content.firstElementChild; }
function firstName(n) { return (n || '').trim().split(/\s+/)[0] || ''; }
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 17 ? 'צהריים טובים' : hr < 22 ? 'ערב טוב' : 'לילה טוב';
}
const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const monFmt = new Intl.DateTimeFormat('he-IL', { month: 'short' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });
function relDay(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days < 0) return 'עבר המועד';
  if (days === 0) return 'היום, ' + timeFmt.format(d);
  if (days === 1) return 'מחר, ' + timeFmt.format(d);
  if (days < 7) return `בעוד ${days} ימים`;
  return dayFmt.format(d);
}

function toast(text, opts = {}) {
  const t = h(`<div class="toast${opts.error ? ' error' : ''}"><span class="ti" data-ic="${opts.error ? 'alert' : 'check'}"></span><span class="grow" dir="auto"></span></div>`);
  t.querySelector('.grow').textContent = text;
  if (opts.action) { const b = h(`<button class="small soft"></button>`); b.textContent = opts.action; b.onclick = () => { opts.onAction(); t.remove(); }; t.append(b); }
  $('toasts').prepend(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, opts.ms || 4800);
}

function md(text) {
  const blocks = [], math = [];
  let t = esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(`<pre>${code}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  t = t.replace(/`([^`]+)`/g, (_, code) => { blocks.push(`<code>${code}</code>`); return `\u0000${blocks.length-1}\u0000`; });
  t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g, (match, display, bracket, inline, dollar) => {
    const raw = display || bracket || inline || dollar;
    let decoded = raw.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim();
    decoded = decoded.replace(/[·•]/g, ' \\cdot ').replace(/\\vec\s+([a-zA-Z])'/g, '\\vec{$1}\'').replace(/→/g, ' \\to ').replace(/←/g, ' \\leftarrow ').replace(/−/g, '-');
    const isDisplay = display !== undefined || bracket !== undefined;
    let rendered;
    try { rendered = katex.renderToString(decoded, {displayMode:isDisplay, throwOnError:true, trust:false, strict:'ignore', maxExpand:1000}); }
    catch {
      try { rendered = katex.renderToString(decoded, {displayMode:isDisplay, throwOnError:false, trust:false, strict:'ignore', maxExpand:1000}); }
      catch { rendered = `<code>${esc(decoded)}</code>`; }
    }
    math.push(`<span class="${isDisplay ? 'math-display' : 'math-inline'}" dir="ltr">${rendered}</span>`);
    return `\u0001${math.length-1}\u0001`;
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^#{1,4} (.*)$/gm, '<h4>$1</h4>');
  let html = '', list = null;
  for (const line of t.split('\n')) {
    const ul = line.match(/^\s*[-*•] (.*)/), ol = line.match(/^\s*\d+[.)] (.*)/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (list !== type) { if (list) html += `</${list}>`; html += `<${type}>`; list = type; }
      html += `<li>${(ul || ol)[1]}</li>`;
    } else {
      if (list) { html += `</${list}>`; list = null; }
      if (line.trim()) html += line.startsWith('<h4>') ? line : `<p>${line}</p>`;
    }
  }
  if (list) html += `</${list}>`;
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]).replace(/\u0001(\d+)\u0001/g, (_, i) => math[i]);
}

// Gemini sign-in: Google's page opened in the browser; after signing in it shows a code, which goes here.
function showGeminiCode() {
  if ($('gemCode')) return;
  const card = h(`<div class="overlay" id="gemCode"><div class="wizard" style="width:min(480px,100%)">
    <div class="content"><h1 style="font-size:21px">התחברות ל-Gemini</h1>
    <p class="lead">נפתח דף ההתחברות של Google בדפדפן. התחבר לחשבון שלך, אשר, ו-Google יציג קוד. העתק אותו והדבק כאן.</p>
    <input type="text" class="ltr" placeholder="הדבק את הקוד מ-Google" autocomplete="off">
    <div class="foot"><div class="grow"></div><button class="ghost" data-x>ביטול</button><button class="primary big" data-go>התחבר</button></div></div></div></div>`);
  const go = () => { const v = card.querySelector('input').value.trim(); if (!v) return; send({ type: 'geminiCode', code: v }); card.remove(); toast('מתחבר ל-Gemini...'); };
  card.querySelector('[data-go]').onclick = go;
  card.querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  card.querySelector('[data-x]').onclick = () => { send({ type: 'cancelGeminiLogin' }); card.remove(); };
  document.body.append(card);
  card.querySelector('input').focus();
}

// Usage limit: a small friendly card instead of an error, with a one-click switch to the other AI.
function showLimit(m) {
  // Only Claude for now (Gemini is coming soon): say kindly when it will continue.
  if ($('limitCard')) return;
  const card = h(`<div class="overlay" id="limitCard"><div class="wizard" style="width:min(460px,100%)">
    <div class="art-top" style="height:150px">${ART.ai().replace('<svg', '<svg style="width:230px;height:140px"')}</div>
    <div class="content"><h1 style="font-size:21px">Claude צריך הפסקה קטנה ☕</h1>
    <p class="lead">הגעת למגבלת השימוש לעכשיו${m.reset ? ' (מתאפס ב-' + esc(m.reset) + ')' : ''}. כל מה שכבר ירד נשמר, ואחרי האיפוס לוחצים שוב על "צור סיכום PDF" וממשיכים מאותה נקודה.</p>
    <div class="foot"><div class="grow"></div><button class="primary big" data-x>הבנתי</button></div></div></div></div>`);
  card.querySelector('[data-x]').onclick = () => card.remove();
  document.body.append(card);
}

function confetti() {
  const box = h('<div class="confetti"></div>');
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#fbbf24', '#34d399', '#38bdf8'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * .6 + 's';
    p.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3200);
}

// ---------- Navigation ----------
function show(view) {
  if (S.view === 'sites' && view !== 'sites') send({ type: 'hideSite' });
  S.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  const nav = view === 'course' ? 'courses' : view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === nav || (view === 'sites' && n.dataset.siteLink === S.site)));
  $('main').scrollTop = 0;
  if (view === 'sites') {
    $('siteBarMain').hidden = !!S.viewer; $('viewerBar').hidden = !S.viewer;
    $('siteBackCourse').hidden = !(S.course && $('dlCourse').value);
    requestAnimationFrame(() => placeSite(true));
  }
  if (view === 'home') renderHome();
  if (view === 'tasks') renderTasks($('tasksPage'), false);
  if (view === 'settings' && window.renderStoneField) setTimeout(renderStoneField, 120); else { const sf = document.getElementById('stoneField'); if (sf) sf.remove(); }
  if (view === 'courses' && !S.courses) loadCourses();
}
document.querySelectorAll('.nav-item[data-view]').forEach(n => n.onclick = () => show(n.dataset.view));
// Sites open full-size inside the app, without a toolbar. Anything downloaded there goes straight into the course
// that's open (or the "הורדות" folder), to the folder that fits the site.
const siteFolder = { moodle: 'כללי', portal: 'מידע על הקורס', cs24: 'CS24', notability: 'מחברת', notebooklm: 'CS24', outlook: '', onedrive: '' };
document.querySelectorAll('.nav-item[data-site-link]').forEach(n => n.onclick = () => {
  const site = n.dataset.siteLink;
  const active = [...S.open].filter(num => num > 0).at(-1) || (S.course && S.sections.length ? Math.max(...S.sections.map(s => s.num)) : 0);
  if (S.course && active && ['moodle', 'cs24'].includes(site)) return lectureSource(active, site, 'slides');
  setSaveTarget(S.course && site !== 'portal' ? S.course.name : '', S.course && site !== 'portal' ? 'מידע על הקורס' : '');
  openSite(site);
});
// "My notebook": the Notability app on this PC if it's installed, otherwise Notability on the web inside the app.
document.querySelector('.nav-item[data-notes]').onclick = () => { if (S.course) setTab('notes'); else toast('פתח קורס והוסף דפי מחברת להרצאה המתאימה. אפשר לייצא PDF מכל אפליקציית כתיבה.'); };
$('brand').onclick = () => show('home');

// ---------- Status ----------
function aiName() { return (S.ai && S.ai.provider === 'gemini') ? 'Gemini' : 'Claude'; }
function setupText(s) {
  return { 'installing-claude': 'מתקין את Claude...', 'login-claude': 'ממתין להתחברות בדפדפן...', 'installing-node': 'מכין את הכלים...', 'installing-gemini': 'מתקין את Gemini...', 'login-gemini': 'מכין את ההתחברות ל-Google...', 'installing-codex': 'מתקין את ChatGPT...', 'login-chatgpt': 'ממתין להתחברות ל-ChatGPT בדפדפן...' }[s] || '';
}
function renderStatus() {
  const m = S.moodle;
  const mm = { ready: ['ok', 'מחובר'], connecting: ['wait', 'מתחבר...'], checking: ['wait', 'בודק...'], login: ['bad', 'לחץ כדי להתחבר'], error: ['bad', 'בעיה - לחץ לנסות שוב'] }[m] || ['bad', ''];
  $('moodleDot').className = 'dot ' + mm[0]; $('moodleSub').textContent = mm[1];
  $('moodleChip').className = 'chip ' + (mm[0] === 'ok' ? 'ok' : mm[0] === 'wait' ? 'warn' : 'bad'); $('moodleChip').textContent = mm[1];
  $('moodleConnect').textContent = m === 'ready' ? 'התחבר מחדש' : 'התחבר';

  const a = S.ai;
  $('aiText').textContent = aiName();
  let dot = 'wait', sub = 'בודק...';
  if (a) {
    if (a.setup) { dot = 'wait'; sub = setupText(a.setup); }
    else if (a.ready) { dot = 'ok'; sub = 'מחובר'; }
    else { dot = 'bad'; sub = 'לחץ כדי לחבר'; }
  }
  $('aiDot').className = 'dot ' + dot; $('aiSub').textContent = sub;
  // The sidebar only speaks up when something needs attention.
  $('moodlePill').hidden = mm[0] !== 'bad';
  $('aiPill').hidden = !(a && !a.ready && !a.setup);
  $('moodlePill').classList.add('alert'); $('aiPill').classList.add('alert');
  $('aiChip').className = 'chip ' + (dot === 'ok' ? 'ok' : dot === 'wait' ? 'warn' : 'bad'); $('aiChip').textContent = aiName() + ' · ' + sub;
  renderProviders();
  renderBanners();
  renderWizardMoodle();
}
$('moodlePill').onclick = () => { if (S.moodle === 'ready') toast('Moodle מחובר ✓'); else connectMoodle(); };
$('aiPill').onclick = () => { if (S.ai && S.ai.ready) toast(aiName() + ' מחובר ✓'); else openWizard(1); };
$('moodleConnect').onclick = connectMoodle;
function connectMoodle() { S.moodle = 'connecting'; renderStatus(); send({ type: 'connectMoodle' }); }

function renderBanners() {
  const b = $('banners'); b.innerHTML = '';
  if (S.prep) b.append(bannerEl(`מכין את הקורסים שלך ברקע · ${S.prep.done + 1} מתוך ${S.prep.total}: ${esc(S.prep.course || '')}`, 'לקורסים', () => show('courses')));
  if (S.updateReady) b.append(bannerEl(`גרסה ${esc(S.updateReady)} מוכנה`, 'הפעל מחדש עכשיו', () => send({ type: 'restartForUpdate' })));
  else if (S.update && S.update.progress) b.append(bannerEl(esc(S.update.progress), S.update.error ? 'לדף ההורדה' : '...', () => S.update.error && send({ type: 'openLink', url: S.update.url }), S.update.error ? 'warn' : ''));
  else if (S.update && S.dismissedUpdate !== S.update.version) {
    const notice = bannerEl(`גרסה חדשה זמינה: ${esc(S.update.version)}`, S.update.canAuto ? 'הורד והתקן בסגירה' : 'להורדה', () => S.update.canAuto ? send({ type: 'installUpdate' }) : send({ type: 'openLink', url: S.update.url }));
    const later = h('<button class="small ghost">לא עכשיו</button>'); later.onclick = () => { S.dismissedUpdate = S.update.version; renderBanners(); }; notice.append(later); b.append(notice);
  }
  if (S.ai && !S.ai.ready && !S.ai.setup) b.append(bannerEl('חבר את המנוע החכם כדי לסכם שיעורים ולשאול שאלות', 'חבר עכשיו', () => openWizard(1), 'warn'));
  if (S.moodle === 'login') b.append(bannerEl('צריך להתחבר ל-Moodle כדי לראות את הקורסים', 'התחבר', connectMoodle, 'warn'));
}
function bannerEl(text, action, fn, cls = '') {
  const el = h(`<div class="banner ${cls}"><span data-ic="${cls ? 'alert' : 'sparkles'}"></span><span class="grow">${text}</span><button class="small">${esc(action)}</button></div>`);
  el.querySelector('button').onclick = fn;
  return el;
}

// ---------- Providers (settings + setup) ----------
// Gemini and ChatGPT are "helpers": they connect with the student's own API key and take the light work (chat questions,
// reading a page or a syllabus), which saves the Claude quota.
// They sign in with the student's own account (the subscription), like on their websites - no key needed. An API key is still
// possible, tucked away for the few who have one. `S.ai.helpers[kind]` is "account", "key" or "".
function helperMode(kind) { const hm = (S.ai && S.ai.helpers) || {}; return hm[kind] || ''; }
function helpersConnected() { return helperMode('gemini') !== '' || helperMode('openai') !== ''; }
function helperCard(kind) {
  const gem = kind === 'gemini';
  const name = gem ? 'Gemini' : 'ChatGPT';
  const brain = gem ? 'gemini' : 'chatgpt';
  const mode = helperMode(kind);
  const setup = (S.ai && S.ai.setup) || '';
  const busy = gem ? /gemini/.test(setup) : /codex|chatgpt/.test(setup) || (/node/.test(setup) && S.brainBusy === brain);
  const desc = gem ? 'מתחברים עם חשבון Google שלך, כמו באתר. עובד גם עם Gemini Plus / Pro, וגם בחינם. בודק את Claude, עונה בצ\'אט וקורא דפים.'
    : 'מתחברים עם חשבון ChatGPT שלך, כמו באתר. צריך מנוי ChatGPT (Plus ומעלה). בודק את Claude, עונה בצ\'אט וקורא דפים.';
  let state = '', act = '';
  if (busy) state = `<span class="spinner"></span>${setupText(setup)}`;
  else if (mode === 'account') { state = '<span class="chip ok"><span data-ic="check"></span>מחובר עם החשבון שלך</span>'; act = '<button class="ghost small" data-logout>התנתק</button><button class="ghost small" data-test>בדוק שזה עובד</button>'; }
  else if (mode === 'key') { state = '<span class="chip ok"><span data-ic="check"></span>מחובר עם מפתח</span>'; act = `<button class="soft small" data-login>עבור לחשבון ${gem ? 'Google' : 'ChatGPT'}</button><button class="ghost small" data-rm>הסר מפתח</button>`; }
  else act = `<button class="primary small" data-login>התחבר עם חשבון ${gem ? 'Google' : 'ChatGPT'}</button>`;
  // While the Google page is open: say what to do (the app carries on by itself when the account is saved).
  const codeBox = gem && S.authCode ? `<div class="auth-code" dir="rtl"><b>כמעט סיימנו</b>
    <small>${S.authCode.phase === 'verify' ? 'בודק שהחשבון יכול לענות. הבדיקה אורכת עד 45 שניות.' : 'נפתח חלון ההתחברות הרשמי של Google Antigravity. בחר Google ופעל לפי ההוראות בחלון. אם מוצג קוד בדפדפן, הדבק אותו בחלון ההתחברות. לאחר האישור נחזור לאפליקציה.'}</small><button class="ghost small" data-cancel-login>בטל התחברות</button></div>` : '';  const curModel = (S.settings && S.settings.geminiModel) || (mode === 'account' ? 'gemini-3.8-flash-low' : 'gemini-1.5-flash');
  const modelOptions = mode === 'account'
    ? `<option value="gemini-3.8-flash-low" ${curModel === 'gemini-3.8-flash-low' ? 'selected' : ''}>Gemini 3.8 Flash (Low - מהיר וללא מכסה)</option>
       <option value="gemini-3.8-flash-medium" ${curModel === 'gemini-3.8-flash-medium' ? 'selected' : ''}>Gemini 3.8 Flash (Medium)</option>
       <option value="gemini-3.8-flash-high" ${curModel === 'gemini-3.8-flash-high' ? 'selected' : ''}>Gemini 3.8 Flash (High)</option>
       <option value="claude-sonnet-5-5-low" ${curModel === 'claude-sonnet-5-5-low' ? 'selected' : ''}>Claude Sonnet 5.5 (Low - גיבוי)</option>
       <option value="gemini-4-argon-low" ${curModel === 'gemini-4-argon-low' ? 'selected' : ''}>Gemini 4 Argon (Low)</option>
       <option value="gemini-4-argon-medium" ${curModel === 'gemini-4-argon-medium' ? 'selected' : ''}>Gemini 4 Argon (Medium)</option>`
    : `<option value="gemini-1.5-flash" ${curModel === 'gemini-1.5-flash' ? 'selected' : ''}>Gemini 1.5 Flash (מהיר וחסכוני)</option>
       <option value="gemini-1.5-flash-8b" ${curModel === 'gemini-1.5-flash-8b' ? 'selected' : ''}>Gemini 1.5 Flash-8B (מכסה גבוהה)</option>
       <option value="gemini-2.0-flash" ${curModel === 'gemini-2.0-flash' ? 'selected' : ''}>Gemini 2.0 Flash (הדור החדש)</option>
       <option value="gemini-1.5-pro" ${curModel === 'gemini-1.5-pro' ? 'selected' : ''}>Gemini 1.5 Pro (חכם ומעמיק)</option>`;
  const modelBox = gem ? `<div class="row gemini-model-row" style="width:100%;margin-top:6px;gap:6px;align-items:center;"><span style="font-size:12px;opacity:0.8;">מודל:</span><select class="small" data-gemini-model style="flex:1;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:12px;">${modelOptions}</select></div>` : '';
  const keyBox = codeBox + (mode === 'key' || busy ? '' : `<details class="adv"><summary>יש לי מפתח API</summary><div class="row" style="width:100%"><input type="password" class="ltr" placeholder="הדבק מפתח API" data-key autocomplete="off"><button class="small" data-save>חבר</button></div><button class="link" data-getkey>איך משיגים מפתח?</button></details>`) + modelBox;
  const tr = (S.brainTests || {})[brain];
  const testLine = !mode || !tr ? '' : tr.busy ? '<div class="test-line">בודק...</div>' : tr.ok ? `<div class="test-line ok">✓ ענה תוך ${(tr.ms / 1000).toFixed(1)} שניות</div>` : `<div class="test-line bad">✗ ${esc(tr.text || 'לא ענה')}</div>`;
  const el = h(`<div class="provider${mode ? ' selected' : ''}" data-kind="${kind}"><span class="chip ${mode ? 'ok' : ''} tag">${mode ? 'מחובר' : 'עוזר · לא חובה'}</span>
    <div class="ph"><span class="pl ${kind}" data-ic="${gem ? 'gemini' : 'sparkles'}"></span><div><h3>${name}</h3></div></div>
    <p>${desc}</p>
    <div class="state">${state}</div>
    <div class="act">${act}</div>${testLine}${keyBox}</div>`);
  el.onclick = (e) => e.stopPropagation();
  const login = el.querySelector('[data-login]');
  if (login) login.onclick = () => { S.brainBusy = brain; send({ type: 'connectBrain', kind: brain }); toast(gem ? 'נפתח חלון ההתחברות הרשמי. בחר Google והשלם בו את ההתחברות.' : 'נפתח דפדפן להתחברות עם ChatGPT. אשר שם והאפליקציה תמשיך לבד.', { ms: 7000 }); };
  const cancel = el.querySelector('[data-cancel-login]'); if (cancel) cancel.onclick = () => { cancel.disabled = true; cancel.textContent = 'מבטל…'; send({type:'cancelGeminiLogin'}); };
  const tst = el.querySelector('[data-test]'); if (tst) tst.onclick = () => { S.brainTests = S.brainTests || {}; S.brainTests[brain] = { busy: true }; renderProviders(); send({ type: 'testBrain', kind: brain }); };
  const out = el.querySelector('[data-logout]'); if (out) out.onclick = () => { if (confirm(`להתנתק מ-${name}?`)) send({ type: 'disconnectBrain', kind: brain }); };
  const rm = el.querySelector('[data-rm]'); if (rm) rm.onclick = () => send({ type: 'removeHelperKey', provider: kind });
  const modelSel = el.querySelector('[data-gemini-model]');
  if (modelSel) {
    modelSel.onchange = () => {
      const chosen = modelSel.value;
      S.settings = S.settings || {};
      S.settings.geminiModel = chosen;
      send({ type: 'setGeminiModel', model: chosen });
      toast('מודל Gemini עודכן ל-' + chosen);
    };
  }
  const save = el.querySelector('[data-save]');
  if (save) {
    const go = () => { const v = el.querySelector('[data-key]').value.trim(); if (!v) return; save.disabled = true; save.textContent = 'בודק...'; send({ type: 'setHelperKey', provider: kind, key: v }); };
    save.onclick = go; el.querySelector('[data-key]').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    el.querySelector('[data-getkey]').onclick = () => send({ type: gem ? 'openGeminiKeyPage' : 'openOpenAiKeyPage' });
  }
  return el;
}

function providerCard(kind) {
  if (kind !== 'claude') return helperCard(kind);
  const a = S.ai || { claude: {}, gemini: {} };
  const sel = kind === 'claude';
  const c = kind === 'claude' ? a.claude || {} : a.gemini || {};
  const busy = a.setup && ((kind === 'claude' && a.setup.includes('claude')) || (kind === 'gemini' && /gemini|node/.test(a.setup)));
  let state, act = '';
  if (kind === 'claude') {
    if (busy) state = `<span class="spinner"></span>${setupText(a.setup)}`;
    else if (c.loggedIn) {
      state = `<span class="chip ok"><span data-ic="check"></span>מחובר</span><span class="muted ltr">${esc(c.email || '')}</span>`;
      act = '<button class="ghost small" data-act="testClaude">בדוק שזה עובד</button><button class="ghost small" data-act="disconnectClaude">התנתק</button>';
    }
    else if (c.installed) { state = '<span class="chip warn">מותקן, לא מחובר</span>'; act = '<button class="primary small" data-act="setupClaude">התחבר לחשבון Claude</button>'; }
    else { state = '<span class="chip">לא מותקן</span>'; act = '<button class="primary small" data-act="setupClaude">התקן והתחבר</button>'; }
  } else {
    if (busy) state = `<span class="spinner"></span>${setupText(a.setup)}`;
    else if (c.installed && (c.hasKey || c.google)) state = `<span class="chip ok"><span data-ic="check"></span>מחובר</span><span class="muted">${c.google && !c.hasKey ? 'עם חשבון Google' : 'עם מפתח'}</span>`;
    else if (c.installed) state = '<span class="chip warn">מותקן, לא מחובר</span>';
    else { state = '<span class="chip">לא מותקן</span>'; act = '<button class="primary small" data-act="setupGemini">התקן את Gemini</button>'; }
    if (c.installed && !busy) act = `<button class="primary small" data-act="loginGemini">${c.google ? 'התחבר מחדש עם Google' : 'התחבר עם חשבון Google'}</button>
      <span class="muted" style="font-size:12px;width:100%">חינמי, או לפי המנוי שלך (Google AI Pro / Ultra). או במפתח API:</span>
      <div class="row" style="width:100%"><input type="password" class="ltr" placeholder="${c.hasKey ? 'המפתח שמור · אפשר להחליף' : 'מפתח API (לא חובה)'}" data-key><button class="small" data-act="saveKey">שמור</button></div>
      <button class="link" data-act="getKey">קבל מפתח מ-Google AI Studio</button>`;
  }
  const tr = (S.brainTests || {})[kind];
  const testLine = !(c && c.loggedIn) || !tr ? '' : tr.busy ? '<div class="test-line">בודק...</div>' : tr.ok ? `<div class="test-line ok">✓ ענה תוך ${(tr.ms / 1000).toFixed(1)} שניות</div>` : `<div class="test-line bad">✗ ${esc(tr.text || 'לא ענה')}</div>`;
  const el = h(`<div class="provider${sel ? ' selected' : ''}" data-kind="${kind}">
    ${kind === 'claude' ? '<span class="chip accent tag">מומלץ</span>' : '<span class="chip ok tag">חינמי או מנוי</span>'}
    <div class="ph"><span class="pl ${kind}" data-ic="${kind}"></span><div><h3>${kind === 'claude' ? 'Claude' : 'Gemini'}</h3></div></div>
    <p>${kind === 'claude' ? 'הכי טוב בסיכומים ארוכים ובבניית דפי לימוד. דורש חשבון Claude (Pro ומעלה מומלץ).' : 'מתחברים עם חשבון Google: חינמי, או עם המנוי שלך (למשל Google AI Pro לסטודנטים). טוב מאוד לצ\'אט ולשאלות, וגם גיבוי כשנגמרת המכסה של Claude.'}</p>
    <div class="state">${state}</div><div class="act">${act}</div>${testLine}</div>`);
  el.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    if (t) {
      e.stopPropagation();
      const actn = t.dataset.act;
      if (actn === 'setupClaude') { send({ type: 'setProvider', provider: 'claude' }); send({ type: 'setupClaude' }); toast('מתחבר ל-Claude. אם נפתח דפדפן, אשר שם את ההתחברות.'); }
      if (actn === 'testClaude') { S.brainTests = S.brainTests || {}; S.brainTests.claude = { busy: true }; renderProviders(); send({ type: 'testBrain', kind: 'claude' }); }
      if (actn === 'disconnectClaude') { if (confirm('להתנתק מ-Claude?')) send({ type: 'disconnectBrain', kind: 'claude' }); }
      if (actn === 'setupGemini') { send({ type: 'setProvider', provider: 'gemini' }); send({ type: 'setupGemini' }); }
      if (actn === 'getKey') send({ type: 'openGeminiKeyPage' });
      if (actn === 'loginGemini') { send({ type: 'setProvider', provider: 'gemini' }); send({ type: 'loginGemini' }); toast('ההתחברות ל-Gemini לוקחת קצת זמן. אשר בחלון שנפתח והאפליקציה תמשיך לבד.'); }
      if (actn === 'saveKey') { const v = el.querySelector('[data-key]').value.trim(); if (v.length < 20) return toast('המפתח נראה קצר מדי', { error: true }); send({ type: 'setGeminiKey', key: v }); send({ type: 'setProvider', provider: 'gemini' }); toast('המפתח נשמר בצורה מוצפנת'); }
      return;
    }
    if (e.target.closest('input')) return;
    if (!sel) send({ type: 'setProvider', provider: kind });
  };
  return el;
}
function renderProviders(force) {
  for (const id of ['providers', 'wizProviders']) {
    const box = $(id);
    if (!box) continue;
    const focused = !force && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (focused) continue;
    box.innerHTML = '';
    box.append(providerCard('claude'), providerCard('gemini'), providerCard('openai'));
  }
}

// ---------- Timetable (from the portal export) ----------
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// Four numbers at the top of the home page.
function homeEvents() {
  const tasks=(S.tasks||[]).filter(t=>!t.done).map(t=>({name:t.title,course:t.course||'מטלה אישית',when:t.due?new Date(t.due+'T23:59:00').getTime()/1000:null,manual:true,id:t.id,overdue:t.due?new Date(t.due+'T23:59:00').getTime()<Date.now():false}));
  return [...(S.events||[]),...tasks].sort((a,b)=>(a.when||Infinity)-(b.when||Infinity));
}
function renderStats() {
  const box = $('stats'); if (!box) return;
  const cur = (S.courses || []).filter(c => c.current);
  const openTasks = (S.tasks || []).filter(t => !t.done).length;
  const week = homeEvents().filter(e => e.when && !e.overdue && e.when * 1000 - Date.now() < 7 * 86400000).length;
  const exams = ((S.timetable && S.timetable.exams) || []).filter(x => x.date && new Date(x.date + 'T12:00:00') >= new Date(new Date().toDateString())).sort((a, b) => a.date.localeCompare(b.date));
  const days = exams.length ? Math.max(0, Math.round((new Date(exams[0].date + 'T12:00:00') - new Date(new Date().toDateString())) / 86400000)) : null;
  const tile = (ic, cls, value, label) => `<div class="stat-tile"><span class="ic ${cls}" data-ic="${ic}"></span><div><b>${value}</b><small>${label}</small></div></div>`;
  box.innerHTML = tile('book', 'file', S.courses ? cur.length : '·', 'קורסים בסמסטר')
    + tile('check', 'assign', openTasks, openTasks === 1 ? 'מטלה פתוחה שלי' : 'מטלות פתוחות שלי')
    + tile('calendar', 'zoom', S.events || (S.tasks||[]).length ? week : '·', 'מטלות השבוע')
    + tile('exam', 'other', days == null ? '—' : days, days == null ? 'אין מבחן בלוח' : days === 1 ? 'יום למבחן הבא' : 'ימים למבחן הבא');
  icons(box);
}

// The next class on the timetable and the next exam, in one glance.
function renderNextUp() {
  const box = $('nextUp'); if (!box) return;
  box.innerHTML = '';
  const tt = S.timetable;
  if (!tt || !((tt.classes || []).length || (tt.exams || []).length)) {
    const e = h('<div class="empty" style="border:none;padding:6px"><b>עוד אין מערכת</b>אפשר לטעון אותה מהפורטל, והאפליקציה תראה כאן מה הבא בתור.</div>');
    box.append(e); return;
  }
  const toMin = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  let next = null;
  for (let d = 0; d < 8 && !next; d++) {
    const name = DAYS[(now.getDay() + d) % 7];
    const rows = (tt.classes || []).filter(c => (c.day || '').replace(/^יום\s*/, '').trim() === name && toMin(c.start) != null && (d > 0 || toMin(c.start) > nowMin)).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (rows.length) next = { c: rows[0], d, name };
  }
  if (next) {
    const when = next.d === 0 ? 'היום' : next.d === 1 ? 'מחר' : 'ביום ' + next.name;
    const r = h(`<div class="next-row"><span class="ic zoom" data-ic="book"></span><div class="grow"><small>השיעור הבא</small><b dir="auto"></b><span class="muted" dir="auto"></span></div><span class="chip accent"></span></div>`);
    r.querySelector('b').textContent = next.c.course;
    r.querySelector('.muted').textContent = [next.c.kind, next.c.room].filter(Boolean).join(' · ');
    r.querySelector('.chip').textContent = when + ' · ' + next.c.start;
    box.append(r);
  }
  const exams = (tt.exams || []).filter(x => x.date && new Date(x.date + 'T12:00:00') >= new Date(now.toDateString())).sort((a, b) => a.date.localeCompare(b.date));
  if (exams.length) {
    const x = exams[0], days = Math.round((new Date(x.date + 'T12:00:00') - new Date(now.toDateString())) / 86400000);
    const r = h(`<div class="next-row"><span class="ic assign" data-ic="exam"></span><div class="grow"><small>המבחן הבא</small><b dir="auto"></b><span class="muted" dir="auto"></span></div><span class="chip ${days < 14 ? 'warn' : ''}"></span></div>`);
    r.querySelector('b').textContent = x.course + (x.moed ? ' · מועד ' + x.moed : '');
    r.querySelector('.muted').textContent = [x.date.split('-').reverse().join('/'), x.time, x.room].filter(Boolean).join(' · ');
    r.querySelector('.chip').textContent = days === 0 ? 'היום' : days === 1 ? 'מחר' : 'בעוד ' + days + ' ימים';
    box.append(r);
  }
  if (!box.children.length) box.append(h('<div class="muted" style="padding:8px">אין שיעורים או מבחנים קרובים במערכת.</div>'));
  icons(box);
}

function renderTimetable() {
  const box = $('timetable'); box.innerHTML = ''; if ($('examBoard')) $('examBoard').innerHTML = '';
  const tt = S.timetable;
  if (!tt || !((tt.classes || []).length || (tt.exams || []).length)) {
    renderNextUp(); renderStats();
    const e = h(`<div class="empty" style="border:none;padding:10px">${ART.calendar().replace('<svg', '<svg class="art"')}<b>הוסף את המערכת ואת לוח המבחנים</b>
      בפורטל מידע אישי: במערכת שעות בוחרים "מבנה יומן" ולוחצים "שמור את הדף כ-PDF", ואותו הדבר ב"לוח בחינות". הקבצים נשמרים לבד, ואחר כך לוחצים כאן "עדכן מערכת".
      <div class="row"><button class="primary" data-p>פתח את הפורטל</button><button class="soft" data-i><span data-ic="refresh"></span>עדכן מערכת</button></div></div>`);
    e.querySelector('[data-p]').onclick = () => { setSaveTarget('', ''); openSite('portal'); };
    e.querySelector('[data-i]').onclick = () => send({ type: 'importTimetable', fromFolder: true });
    box.append(e);
    return;
  }
  const today = DAYS[new Date().getDay()];
  const todays = (tt.classes || []).filter(c => c.day === today).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const exams = (tt.exams || []).filter(x => x.date && new Date(x.date) >= new Date(new Date().toDateString())).sort((a, b) => a.date.localeCompare(b.date));
  const day = h(`<div><h3 style="margin-bottom:8px">היום · יום ${today}</h3></div>`);
  if (!todays.length) day.append(h('<div class="muted">אין שיעורים היום.</div>'));
  todays.forEach(c => { const r = h(`<div class="deadline"><div class="cal"><b style="font-size:13px;margin-top:10px">${esc(c.start)}</b><small>${esc(c.end)}</small></div><div class="info"><div class="name" dir="auto"></div><div class="course" dir="auto"></div></div></div>`); r.querySelector('.name').textContent = c.course; r.querySelector('.course').textContent = [c.kind, c.room, c.lecturer].filter(Boolean).join(' · '); day.append(r); });
  const ex = h('<div></div>'); const eb = $('examBoard'); eb.innerHTML = ''; eb.append(ex);
  if (!exams.length) ex.append(h('<div class="muted">אין מבחנים קרובים במערכת.</div>'));
  exams.forEach(x => { const d = new Date(x.date); const r = h(`<div class="deadline${(d - new Date()) < 14 * 86400000 ? ' soon' : ''}"><div class="cal"><b>${d.getDate()}</b><small>${esc(monFmt.format(d))}</small></div><div class="info"><div class="name" dir="auto"></div><div class="course"></div></div><span class="chip">מועד ${esc(x.moed || '')}</span></div>`); r.querySelector('.name').textContent = x.course; r.querySelector('.course').textContent = [x.time, x.room].filter(Boolean).join(' · '); ex.append(r); });
  const weekly = h('<div class="week-table"><table><caption>מערכת השעות השבועית המלאה</caption><thead><tr><th>יום</th><th>שעות</th><th>קורס</th><th>סוג</th><th>חדר</th><th>מרצה</th></tr></thead><tbody></tbody></table></div>');
  DAYS.forEach(d => (tt.classes || []).filter(c => c.day === d).sort((a,b) => (a.start || '').localeCompare(b.start || '')).forEach(c => {
    const row = document.createElement('tr');
    [d, [c.start,c.end].filter(Boolean).join('–'),c.course,c.kind,c.room,c.lecturer].forEach((v,i) => { const cell = document.createElement('td'); cell.textContent = v || ''; cell.dir = i === 1 ? 'ltr' : 'auto'; row.append(cell); });
    weekly.querySelector('tbody').append(row);
  }));
  box.append(day);
  const wg = weekGrid(tt.classes || []);
  if (wg) box.append(wg);
  const list = h('<details class="week-list"><summary>הצג כרשימה</summary></details>'); list.append(weekly); box.append(list);
  renderNextUp(); renderStats();
}
// The week as a table: days across, hours down, every class in its own colour.
const COURSE_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6'];
function courseColor(name) { let x = 0; for (const ch of name || '') x = (x * 31 + ch.charCodeAt(0)) | 0; return COURSE_COLORS[Math.abs(x) % COURSE_COLORS.length]; }
function weekGrid(classes) {
  const toMin = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const dayName = (c) => (c.day || '').replace(/^יום\s*/, '').trim();
  const rows = classes.filter(c => toMin(c.start) != null && toMin(c.end) != null && DAYS.includes(dayName(c)));
  if (!rows.length) return null;
  const days = DAYS.slice(0, 5).concat(rows.some(c => dayName(c) === 'שישי') ? ['שישי'] : []).concat(rows.some(c => dayName(c) === 'שבת') ? ['שבת'] : []);
  const from = Math.floor(Math.min(8 * 60, ...rows.map(c => toMin(c.start))) / 60) * 60;
  const to = Math.ceil(Math.max(13 * 60, ...rows.map(c => toMin(c.end))) / 60) * 60;
  const slots = (to - from) / 30;
  const wrap = h('<div class="week-grid-wrap"><div class="week-grid"></div></div>');
  const g = wrap.firstElementChild;
  g.style.gridTemplateColumns = `46px repeat(${days.length}, minmax(0, 1fr))`;
  g.style.gridTemplateRows = `28px repeat(${slots}, 22px)`;
  const todayName = DAYS[new Date().getDay()];
  days.forEach((d, i) => { const el = h(`<div class="wk-day${d === todayName ? ' today' : ''}">${d}</div>`); el.style.gridColumn = i + 2; el.style.gridRow = 1; g.append(el); });
  for (let t = from; t < to; t += 60) { const el = h(`<div class="wk-hour">${String(t / 60).padStart(2, '0')}:00</div>`); el.style.gridColumn = 1; el.style.gridRow = `${(t - from) / 30 + 2} / span 2`; g.append(el); }
  days.forEach((d, i) => { const col = h('<div class="wk-col"></div>'); col.style.gridColumn = i + 2; col.style.gridRow = `2 / span ${slots}`; g.append(col); });
  rows.forEach(c => {
    const di = days.indexOf(dayName(c)); if (di < 0) return;
    const a = Math.round((toMin(c.start) - from) / 30), b = Math.max(a + 1, Math.round((toMin(c.end) - from) / 30));
    const el = h('<div class="wk-class"><b dir="auto"></b><small dir="auto"></small></div>');
    el.style.gridColumn = di + 2; el.style.gridRow = `${a + 2} / ${b + 2}`; el.style.setProperty('--c', courseColor(c.course));
    el.querySelector('b').textContent = c.course;
    el.querySelector('small').textContent = [c.start + '-' + c.end, c.kind, c.room].filter(Boolean).join(' · ');
    el.title = [c.course, c.kind, c.lecturer, c.room, c.start + '-' + c.end].filter(Boolean).join('\n');
    g.append(el);
  });
  return wrap;
}
$('ttImport').onclick = () => send({ type: 'importTimetable', fromFolder: true });
$('ttDelete').onclick = () => { if (confirm('למחוק את המערכת, לוח המבחנים והקבצים ששמרת מהפורטל?')) send({ type: 'deleteTimetable' }); };

// ---------- Home ----------
// For homework deadlines: whether the syllabus says it counts (known after "learn the course" read the syllabus).
function hwNote(e) {
  if (e.mod !== 'assign') return '';
  const c = (S.courses || []).find(x => x.id === e.courseId);
  const info = c && c.local && c.local.info;
  if (!info || info.homeworkRequired == null) return '';
  return info.homeworkRequired ? ' · <span class="chip warn">חובה להגשה</span>' : ' · <span class="chip">לא חובה, אבל מומלץ ללמידה</span>';
}

// "תשפז_א" / "תשפ"ו א'" in a course name or code -> "תשפ״ז · סמסטר א"
function semesterOf(c) {
  const m = ((c.short || '') + ' ' + (c.name || '')).match(/(תש[א-ת]["״']?[א-ת])[_\s-]*([אבג])['׳]?(?![א-ת])/);
  if (!m) return c.current ? 'הסמסטר הנוכחי' : 'סמסטרים קודמים';
  const y = m[1].replace(/["״']/g, '');
  return `${y.slice(0, -1)}״${y.slice(-1)} · סמסטר ${m[2]}`;
}
function renderHome() {
  renderStats(); renderNextUp();
  const name = firstName(S.userName || S.settings.userName);
  $('today').textContent = dayFmt.format(new Date());
  $('greeting').textContent = greeting() + (name ? `, ${name}` : '') + ' 👋';
  const ev = homeEvents().filter(e => e.manual || !e.overdue || Date.now() / 1000 - e.when < 3 * 86400);
  const week = ev.filter(e => e.when && !e.overdue && e.when * 1000 - Date.now() < 7 * 86400000);
  $('heroLine').textContent = S.events == null && !ev.length ? (S.moodle === 'login' ? 'התחבר ל-Moodle כדי לראות מה מחכה לך.' : 'טוען את מה שמחכה לך השבוע...')
    : week.length ? `יש לך ${week.length} ${week.length === 1 ? 'משימה' : 'משימות'} בשבוע הקרוב. אפשר להתחיל ממה שהכי דחוף.`
    : 'אין מטלות בשבוע הקרוב. זמן מצוין לחזור על החומר.';
  $('deadlineCount').textContent = ev.length + ' מטלות';

  const box = $('deadlines'); box.innerHTML = '';
  if (S.events == null && !ev.length) {
    for (let i = 0; i < 4; i++) box.append(h('<div class="deadline"><div class="cal skeleton"></div><div class="info"><div class="skeleton" style="height:12px;width:60%"></div><div class="skeleton" style="height:10px;width:40%;margin-top:8px"></div></div></div>'));
  } else if (!ev.length) {
    box.append(h(`<div class="empty" style="border:none;padding:16px">${ART.calendar().replace('<svg', '<svg class="art"')}<b>הכל בשליטה</b>אין מטלות פתוחות בשבועות הקרובים.</div>`));
  } else {
    ev.slice(0, 7).forEach((e, i) => {
      const d = new Date(e.when * 1000);
      const soon = e.when && e.when * 1000 - Date.now() < 2 * 86400000;
      const el = h(`<div class="deadline${e.overdue ? ' over' : soon ? ' soon' : ''}" style="--i:${i}"><div class="cal"><b>${e.when ? d.getDate() : '—'}</b><small>${e.when ? esc(monFmt.format(d)) : 'ללא מועד'}</small></div>
        <div class="info"><div class="name" dir="auto">${esc(e.name)}</div><div class="course" dir="auto">${esc(e.course)}${hwNote(e)}</div></div><span class="chip${e.overdue ? ' bad' : soon ? ' warn' : ''}">${e.when ? esc(relDay(e.when)) : 'ללא תאריך'}</span></div>`);
      el.onclick = () => e.manual ? show('tasks') : openSite('moodle', e.url);
      box.append(el);
    });
  }

  const hc = $('homeCourses'); hc.innerHTML = '';
  if (!S.courses) for (let i = 0; i < 4; i++) hc.append(h('<div class="skeleton" style="height:170px;border-radius:18px"></div>'));
  else {
    const cur = S.courses.filter(c => c.current);
    if (!cur.length) hc.append(h('<div class="empty" style="grid-column:1/-1">אין קורסים פעילים כרגע.</div>'));
    cur.forEach((c, i) => hc.append(courseCard(c, i)));
  }
}
$('heroArt').innerHTML = ART.mascot('wave');
$('heroCourses').innerHTML = IC.book + 'לקורסים שלי';
$('heroCourses').onclick = () => show('courses');
$('heroPaste').innerHTML = IC.plus + 'הוסף מטלה';
$('heroPaste').onclick = () => { show('tasks'); setTimeout(() => { const f = document.querySelector('#tasksPage [data-t-title]'); if (f) f.focus(); }, 80); };
$('allCourses').onclick = () => show('courses');
(function quick() {
  const items = [
    ['c3', 'user', 'פורטל מידע אישי', 'ציונים, מערכת שעות ובחינות', () => openSite('portal')],
    ['c4', 'folder', 'תיקיית הקורסים', 'כל החומר שהורדת', () => send({ type: 'openFolder', which: 'study' })]
  ];
  for (const [c, ic, t, s, fn] of items) {
    const b = h(`<button><span class="qi ${c}" data-ic="${ic}"></span><span>${t}<small style="display:block">${s}</small></span></button>`);
    b.onclick = fn; $('quick').append(b);
  }
})();

// ---------- Courses ----------
// The lecturer uploaded something since the last download: say what, and ask before downloading it.
function renderNewMaterial() {
  const old = $('newMaterial'); if (old) old.remove();
  const items = S.course && S.newMaterial && S.newMaterial[S.course.name];
  if (!items || !items.length || inSetup()) return;
  const nums = [...new Set(items.map(i => i.num))];
  const names = items.slice(0, 4).map(i => i.name).join(' · ') + (items.length > 4 ? ` ועוד ${items.length - 4}` : '');
  const el = h(`<div class="new-material" id="newMaterial"><span class="qa-av">${ART.mascot('wave')}</span>
    <div class="grow"><b>המרצה העלה ${items.length === 1 ? 'קובץ חדש' : items.length + ' קבצים חדשים'} ל-Moodle</b><small dir="auto"></small></div>
    <div class="row"><button class="primary small"><span data-ic="download"></span>הורד ועדכן את הסיכום</button><button class="ghost small">לא עכשיו</button></div></div>`);
  el.querySelector('small').textContent = names;
  const [go, later] = el.querySelectorAll('button');
  go.onclick = () => {
    send({ type: 'getNewMaterial', course: S.course.name, sections: plainSections(), nums });
    delete S.newMaterial[S.course.name]; el.remove();
    toast('מוריד את החומר החדש, ואז אעדכן את הסיכום של ההרצאה.', { ms: 5000 });
  };
  later.onclick = () => { delete S.newMaterial[S.course.name]; el.remove(); };
  icons(el);
  $('courseStatus').before(el);
}

function markNewOnCard(name, count) {
  const card = [...document.querySelectorAll('.course-card')].find(el => el.dataset.name === name);
  if (!card || card.querySelector('.new-tag')) return;
  const tag = h(`<span class="chip warn new-tag">${count} חדשים ב-Moodle</span>`);
  card.querySelector('.meta').prepend(tag);
}

// A course that is downloading in the background shows its percent on its card.
function markCourseCard(name, pct) {
  const card = [...document.querySelectorAll('.course-card')].find(el => el.dataset.name === name);
  if (!card) return;
  let tag = card.querySelector('.dl-tag');
  if (!tag) { tag = h('<span class="chip accent dl-tag"></span>'); card.querySelector('.meta').prepend(tag); }
  tag.textContent = pct >= 100 ? 'מכין סיכומים...' : 'מוריד · ' + pct + '%';
}

function courseCard(c, i) {
  const L = c.local || {};
  const pages = L.lecturePdfs || L.studyPages || 0;
  const pct = Math.min(100, Math.round(pages * 100 / 13));
  const el = h(`<button class="course-card" style="--i:${i}" data-name="${esc(c.name)}">
    <div class="band">${ART.band(c.id)}<span class="letter">${esc((c.name || '?').trim().charAt(0))}</span>${pages ? `<div class="ring" style="--p:${pct}" data-label="${pages}"></div>` : ''}</div>
    <div class="body"><div class="name" dir="auto">${esc(c.name)}</div><div class="muted" style="font-size:12px" dir="auto">${esc(c.category || '')}</div>
    <div class="meta">${L.exists ? '<span class="chip ok">במחשב</span>' : '<span class="chip">עוד לא הורד</span>'}${pages ? `<span class="chip accent">${pages} ${L.lecturePdfs ? 'סיכומים' : 'דפי לימוד'}</span>` : ''}${L.exams ? `<span class="chip warn">${L.exams} מבחנים</span>` : ''}</div></div></button>`);
  applyBg(el.querySelector('.band'), L.background);
  el.onclick = () => openCourse(c);
  return el;
}
function loadCourses() {
  $('coursesState').innerHTML = '';
  const g = $('courses'); g.innerHTML = '';
  for (let i = 0; i < 8; i++) g.append(h('<div class="skeleton" style="height:180px;border-radius:18px"></div>'));
  send({ type: 'loadCourses' });
}
function renderCourses() {
  const g = $('courses'); g.innerHTML = '';
  const filterVal = $('courseSemesterFilter')?.value || 'current';
  const query = ($('courseSearch')?.value || '').trim().toLowerCase();

  // Populate semester filter options dynamically based on available courses
  const semSelect = $('courseSemesterFilter');
  if (semSelect && S.courses && S.courses.length) {
    const existingVal = semSelect.value;
    const semesters = new Set();
    S.courses.forEach(c => {
      const s = semesterOf(c);
      if (s) semesters.add(s);
    });
    // Rebuild options if needed
    const currentOptions = Array.from(semSelect.options).map(o => o.value);
    const hasCustomSems = [...semesters].some(s => !currentOptions.includes(s));
    if (hasCustomSems || semSelect.options.length <= 2) {
      semSelect.innerHTML = '<option value="current">הסמסטר הנוכחי בלבד</option><option value="all">כל הסמסטרים</option>';
      [...semesters].sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        semSelect.appendChild(opt);
      });
      if (currentOptions.includes(existingVal)) semSelect.value = existingVal;
    }
  }

  const list = (S.courses || []).filter(c => {
    if (filterVal === 'current' && !c.current) return false;
    if (filterVal !== 'current' && filterVal !== 'all' && semesterOf(c) !== filterVal) return false;
    if (query) {
      const name = (c.name || '').toLowerCase();
      const cat = (c.category || '').toLowerCase();
      const short = (c.short || '').toLowerCase();
      if (!name.includes(query) && !cat.includes(query) && !short.includes(query)) return false;
    }
    return true;
  });

  if (!list.length) {
    $('coursesState').innerHTML = '';
    $('coursesState').append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>לא נמצאו קורסים מתאימים</b>נסה לשנות את הסינון או החיפוש.</div>`));
    return;
  }
  $('coursesState').innerHTML = '';
  // One group per semester, current semester first.
  const groups = new Map();
  list.forEach(c => { const k = semesterOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
  const keys = [...groups.keys()].sort((a, b) => (groups.get(b).some(c => c.current) - groups.get(a).some(c => c.current)) || b.localeCompare(a, 'he'));
  let i = 0;
  keys.forEach(k => {
    g.append(h(`<h2 class="semester" style="grid-column:1/-1;margin:${i ? 18 : 0}px 2px 2px">${esc(k)}</h2>`));
    groups.get(k).forEach(c => g.append(courseCard(c, i++)));
  });
}
$('refreshCourses').onclick = loadCourses;
if ($('courseSemesterFilter')) $('courseSemesterFilter').onchange = renderCourses;
if ($('courseSearch')) $('courseSearch').oninput = renderCourses;
if ($('showAll')) $('showAll').onchange = renderCourses;

// ---------- One course ----------
const modIcon = { resource: 'file', file: 'file', assign: 'exam', zoom: 'play', url: 'link', folder: 'folder', page: 'book', quiz: 'exam', forum: 'chat', book: 'book' };
const modLabel = { resource: 'קובץ', file: 'קובץ', assign: 'מטלה', zoom: 'Zoom', url: 'קישור', folder: 'תיקייה', page: 'דף', quiz: 'בוחן', forum: 'פורום', book: 'ספר', label: 'טקסט', lti: 'כלי חיצוני', choice: 'סקר', feedback: 'משוב', h5pactivity: 'תרגול אינטראקטיבי' };

function openCourse(c) {
  rememberCourseUi();
  const saved=runtimeFor(c.name);
  S.course = c; S.sections = []; S.open = new Set(saved.open || []); S.local = c.local || null; S.notability = null;
  $('courseName').textContent = c.name;
  $('courseBand').innerHTML = ART.band(c.id);
  $('lecturer').value = ''; $('lecturer').placeholder = 'מי המרצה?';
  $('courseCount').textContent = 'טוען...'; $('courseReady').hidden = true;
  $('courseStatus').hidden = true;
  $('lectures').innerHTML = '';
  for (let i = 0; i < 6; i++) $('lectures').append(h('<div class="skeleton" style="height:70px;border-radius:16px;margin-bottom:10px"></div>'));
  S.chatScope = saved.chatScope || 'course'; S.chatLogs = saved.chatLogs || {}; S.pendingChat = saved.pendingChat || null; S.chatHidden = true;
  S.chatBusy=!!saved.chatBusy?.[S.chatScope]; $('chatSend').disabled=S.chatBusy; thinking=null;
  resetChat();
  (S.chatLogs[S.chatScope]||[]).forEach(x=>addMsg(x.role,x.text,true));
  if(S.chatBusy)setThinking('ממשיך לעבוד ברקע...');
  // A course that was never set up goes straight to the questions - not the full course screen.
  S.local = S.local || { exists: false };
  applySetupMode();
  restoreCourseRuntime();
  if (!inSetup()) setTab(saved.tab || 'lessons');
  show('course');
  send({ type: 'openCourse', id: c.id, course: c.name });
}
$('backToCourses').onclick = () => { rememberCourseUi(); S.course = null; show('courses'); };
$('reloadCourse').onclick = () => S.course && openCourse(S.course);
$('openCourseFolder').onclick = () => S.local && send({ type: 'openPath', path: S.local.dir });
const plainSections = () => S.sections.map(s => ({ num: s.num, title: s.title, items: s.items }));
function syncCourse(quiet) {
  if (!S.sections.length) return;
  send({ type: 'syncCourse', course: S.course.name, sections: plainSections() });
  if (!quiet) toast('מעדכן את כל הקורס מה-Moodle... אפשר להמשיך לעבוד בינתיים');
}
$('syncAll').onclick = () => syncCourse(false);
$('learnAll').onclick = () => {
  if (!S.sections.length) return;
  send({ type: 'learnCourse', course: S.course.name, sections: plainSections() });
  toast(`${aiName()} מתחיל ללמוד את כל הקורס: מוריד הכל, קורא את הסילבוס, בונה דף לימוד לכל שיעור ולומד את המרצה מהמבחנים. זה לוקח זמן, אפשר להמשיך לעבוד.`, { ms: 8000 });
};
$('examPrepBtn').onclick = () => { setTab('exams'); setChatScope('exam'); };
$('toggleChat').onclick = () => { S.chatHidden = !S.chatHidden; $('courseBody').classList.toggle('no-chat', S.chatHidden); $('chat').hidden = S.chatHidden; };
$('lecturer').onchange = () => S.course && send({ type: 'setLecturer', course: S.course.name, name: $('lecturer').value.trim() });

document.querySelectorAll('#courseTabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#courseTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  if (tab === 'info') renderInfo();
  if (tab === 'exams') renderExams();
  if (tab === 'notes') renderNotes();
  if (tab === 'setup') renderSetup();
  if (tab === 'recs') renderRecs();
}

// ---------- Course setup: a few questions, then one "download everything" ----------
// A new course opens on this and nothing else. The app asks, the student answers, and only then it downloads
// everything at once and starts preparing the study material.
function moodleSummary() {
  const items = S.sections.flatMap(s => s.items);
  const isExam = (i) => /מבחן|בחינה|מועד [אבג]|exam/i.test(i.name) && i.mod !== 'quiz';
  return {
    files: items.filter(i => ['resource', 'file', 'folder', 'page', 'book'].includes(i.mod) && !isExam(i)).length,
    hw: items.filter(i => i.mod === 'assign').length,
    exams: items.filter(isExam).length,
    recs: items.filter(i => i.mod === 'zoom' && /zoom\.us\/rec/i.test(i.url || '')).length,
    zoomTool: items.some(i => i.mod === 'lti' && /zoom|זום/i.test(i.name))
  };
}
// Recordings are numbered by lecture ("הרצאה 1", "הרצאה 2"...), not by Moodle section.
function nextLecture() {
  const have = ((S.local && S.local.lectureRecordings) || []).map(r => +(r.name.match(/\d+/) || [0])[0]);
  const queued = [...S.jobs.values()].filter(j => S.course && j.course === S.course.name && j.num < 0).map(j => -j.num);
  return Math.max(0, ...have, ...queued) + 1;
}
function lectureLinkRow(onAdded, lectureNum) {
  const row = h(`<div class="row wrap"><span class="muted">הרצאה</span><input type="number" min="1" max="200" style="width:76px;height:42px;padding:0 10px;border-radius:11px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font:inherit">
    <input type="text" data-name placeholder="שם ההקלטה (שם הקובץ)"><input type="text" class="ltr" placeholder="https://...zoom.us/rec/..." style="max-width:360px"><button class="soft" data-dl>הורד</button>
    <span class="muted">או</span><button type="button" class="ghost" data-pc><span data-ic="plus"></span>הקלטה מהמחשב</button></div>`);
  const num = row.querySelector('input[type=number]'), link = row.querySelector('input.ltr');
  num.value = lectureNum || nextLecture(); num.disabled = !!lectureNum;
  row.querySelector('[data-name]').value = 'הרצאה מספר ' + num.value;
  if (lectureNum) {
    // Go to the lecture on the Zoom site (through Moodle), open the recording and copy its link from there.
    const go = h('<button type="button" class="link">פתח את ההקלטות ב-Zoom כדי להעתיק קישור</button>');
    go.onclick = () => lectureSource(lectureNum, 'moodle');
    row.append(go);
  }
  const add = () => {
    const url = link.value.trim(); if (!url) return link.focus();
    send({ type: 'addLectureRecording', course: S.course.name, num: +num.value || 1, url, name: row.querySelector('[data-name]').value.trim() });
    link.value = ''; if (!lectureNum) num.value = (+num.value || 1) + 1;
    if (onAdded) onAdded();
  };
  row.querySelector('[data-dl]').onclick = add;
  // A recording (and its transcript, if there is one) already on the PC.
  row.querySelector('[data-pc]').onclick = () => { send({ type: 'addRecordingFile', course: S.course.name, num: +num.value || 1, name: row.querySelector('[data-name]').value.trim() }); if (onAdded) onAdded(); };
  icons(row);
  link.onkeydown = (e) => { if (e.key === 'Enter') add(); };
  return row;
}

function setupAnswers() {
  const k = S.course ? S.course.name : '';
  S.setupAns = S.setupAns || {};
  return S.setupAns[k] = S.setupAns[k] || {};
}
function inSetup() { return false; }
function applySetupMode() {
  const on = inSetup();
  document.querySelector('.course-actions').hidden = on;
  $('courseTabs').hidden = on;
  $('learnAll').hidden = true; $('syncAll').hidden = true;
  document.querySelector('[data-tab=setup]').hidden = true;
  $('courseBody').classList.toggle('no-chat', on || S.chatHidden);
  $('chat').hidden = on || S.chatHidden;
  if (on) setTab('setup');
}

const SETUP_Q = [
  {
    key: 'lecturer',
    ask: () => 'מי המרצה של הקורס?',
    hint: () => $('lecturer').value ? 'מצאתי את השם ב-Moodle. אם זה לא נכון, תקן.' : 'זה עוזר לי לכתוב את החומר בסגנון שלו.',
    body: (done) => {
      const box = h('<div class="row wrap"></div>');
      const inp = h('<input type="text" dir="auto" placeholder="שם המרצה" style="max-width:300px">');
      inp.value = $('lecturer').value;
      const ok = h('<button class="primary">זה נכון</button>');
      ok.onclick = () => { $('lecturer').value = inp.value.trim(); $('lecturer').onchange(); done(inp.value.trim() || 'לא יודע'); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
      box.append(inp, ok);
      return box;
    }
  },
  {
    key: 'moodle',
    ask: () => 'זה מה שמצאתי ב-Moodle. להוריד את הכל?',
    hint: () => {
      const m = moodleSummary();
      const parts = [`${m.files} מצגות וקבצים`, `${m.hw} מטלות ותרגילים`];
      if (m.exams) parts.push(`${m.exams} מבחנים`);
      if (m.recs) parts.push(`${m.recs} הקלטות`);
      let t = parts.join(' · ') + '.';
      if (!m.recs) t += m.zoomTool ? ' ההקלטות של הקורס נמצאות בכלי הזום של Moodle, שלא מאפשר הורדה, אז אכין הכל בלעדיהן.' : ' אין הקלטות בקורס, וזה בסדר.';
      return t;
    },
    body: (done) => {
      const box = h('<div class="row wrap"></div>');
      const yes = h('<button class="primary">כן, את הכל</button>'); yes.onclick = () => done('כן, את הכל');
      const more = h('<button class="ghost">יש לי עוד קבצים במחשב</button>'); more.onclick = () => send({ type: 'addFiles', course: S.course.name, folder: 'מידע על הקורס' });
      box.append(yes, more);
      return box;
    }
  },
  {
    key: 'recs',
    ask: () => 'יש לך קישורים להקלטות של ההרצאות?',
    hint: () => 'הדבק את הקישור ל-Zoom של ההרצאה. המספר כבר מוכן (הרצאה 1, ואחר כך 2...), ואפשר לשנות אותו. אני אוריד את ההקלטה ואת התמלול.',
    body: (done) => {
      const box = h('<div style="display:grid;gap:8px"></div>');
      const added = h('<div class="muted" style="font-size:12.5px"></div>');
      const row = lectureLinkRow(() => { count++; added.textContent = `${count} הקלטות בהורדה. אפשר להוסיף עוד.`; });
      let count = 0;
      const next = h('<div class="row wrap"></div>');
      const done1 = h('<button class="primary">סיימתי</button>'); done1.onclick = () => done(count ? `${count} הקלטות` : 'בלי הקלטות');
      const none = h('<button class="ghost">אין לי הקלטות</button>'); none.onclick = () => done('אין');
      next.append(done1, none);
      box.append(row, added, next);
      return box;
    }
  },
  {
    key: 'exams',
    ask: () => 'להוריד בשבילך את כל החומר של הקורס מ-CS24?',
    hint: () => 'אני אמצא את הקורס ב-CS24 ואוריד את כל מה שיש שם: מבחנים ופתרונות משנים קודמות, בחנים, סיכומים, מחברות של סטודנטים ותרגולים. זה חומר עזר, ו-Moodle נשאר המקור העיקרי.',
    body: (done) => {
      const box = h('<div class="row wrap"></div>');
      const yes = h('<button class="primary">כן, תוריד הכל</button>'); yes.onclick = () => { setupAnswers().cs24Auto = true; done('כן, הכל מ-CS24'); };
      const pc = h('<button class="ghost">יש לי מבחנים במחשב</button>'); pc.onclick = () => send({ type: 'addFiles', course: S.course.name, folder: 'מבחנים' });
      const no = h('<button class="ghost">לא צריך</button>'); no.onclick = () => { setupAnswers().cs24Auto = false; done('בלי CS24'); };
      box.append(yes, pc, no);
      return box;
    }
  },
  {
    key: 'notes',
    ask: () => 'אתה כותב בהרצאות ב-Notability?',
    hint: () => 'אם כן, אשתמש גם במחברת שלך. מייצאים אותה ל-PDF לתיקייה "מחברת" של הקורס.',
    body: (done) => {
      const box = h('<div class="row wrap"></div>');
      const y = h('<button class="primary">כן, פתח את Notability</button>'); y.onclick = () => { send({ type: 'openNotability', course: S.course.name }); done('כן'); };
      const n = h('<button class="ghost">לא</button>'); n.onclick = () => done('לא');
      box.append(y, n);
      return box;
    }
  }
];

function renderSetup() {
  const p = $('pane-setup'); p.innerHTML = '';
  if ($('newMaterial')) $('newMaterial').remove();
  // Downloading: only the progress, so it's the first thing the student sees.
  if (S.setupRunning && S.setupRunning[S.course.name]) {
    const box = h(`<div class="card pad-lg setup-step"><div class="qa-row now"><span class="qa-av">${ART.mascot('wave')}</span><div><div class="qa-q">מעולה! אני מוריד עכשיו את כל החומר של הקורס, ואז אכין סיכום PDF לכל הרצאה.</div></div></div></div>`);
    box.append(setupProgressEl(S.course.name));
    p.append(box);
    return;
  }
  // Until the course's lessons arrive from Moodle, just a short "getting ready" card.
  if (!S.sections.length) {
    p.append(h(`<div class="card pad-lg setup-step" style="text-align:center"><div style="width:120px;margin:0 auto 10px">${ART.mascot('wave').replace('<svg', '<svg style="width:120px;height:120px"')}</div>
      <h2>רגע, אני מסתכל על הקורס ב-Moodle...</h2><p class="muted" style="margin:8px 0 0">עוד כמה שניות ואשאל אותך כמה שאלות קצרות.</p>
      <div class="row" style="justify-content:center;margin-top:14px"><span class="spinner"></span></div></div>`));
    return;
  }
  const ans = setupAnswers();
  const current = SETUP_Q.find(q => !(q.key in ans));
  const answered = SETUP_Q.filter(q => q.key in ans);
  $('tabSetup').textContent = current ? SETUP_Q.length - answered.length : '✓';
  const wrap = h(`<div class="card pad-lg setup-step"><div class="step-dots">${SETUP_Q.map(q => `<i class="${q.key in ans ? 'on' : q === current ? 'now' : ''}"></i>`).join('')}<i class="${current ? '' : 'now'}"></i></div><div class="qa"></div></div>`);
  const qa = wrap.querySelector('.qa');
  // What was already asked and answered, as a short conversation.
  answered.forEach(q => {
    const asked = h(`<div class="qa-row"><span class="qa-av">${ART.mascot()}</span><div class="qa-q"></div></div>`);
    asked.querySelector('.qa-q').textContent = q.ask();
    qa.append(asked);
    const a = h('<div class="qa-a" dir="auto"></div>'); a.textContent = ans[q.key]; qa.append(a);
  });
  if (current) {
    const row = h(`<div class="qa-row now"><span class="qa-av">${ART.mascot('wave')}</span><div><div class="qa-q"></div><div class="qa-hint muted" dir="auto"></div></div></div>`);
    row.querySelector('.qa-q').textContent = current.ask();
    row.querySelector('.qa-hint').textContent = current.hint();
    qa.append(row);
    const body = current.body((answer) => { ans[current.key] = answer; renderSetup(); });
    body.classList.add('qa-body');
    qa.append(body);
  } else {
    // Everything answered: one button downloads it all and starts preparing.
    const L = S.local || {};
    const m = moodleSummary();
    const busy = S.setupRunning && S.setupRunning[S.course.name];
    const list = [
      ['book', `מ-Moodle: ${m.files} מצגות וקבצים, ${m.hw} מטלות${m.exams ? `, ${m.exams} מבחנים` : ''}${m.recs ? `, ${m.recs} הקלטות` : ''}`],
      ['exam', ans.cs24Auto ? 'מ-CS24: כל התיקייה של הקורס - מבחנים, בחנים, סיכומים ומחברות' : `מבחנים קודמים: ${L.exams ? L.exams + ' קבצים' : 'בלי CS24'}`],
      ['sparkles', 'ואז: דף לימוד לכל שיעור, עזרה בשיעורי הבית והכנה למבחן']
    ];
    const row = h(`<div class="qa-row now"><span class="qa-av">${ART.mascot('wave')}</span><div><div class="qa-q">מעולה, יש לי את כל מה שצריך. זה מה שאני הולך לעשות:</div></div></div>`);
    qa.append(row);
    const ul = h('<div class="qa-body" style="display:grid;gap:8px"></div>');
    list.forEach(([ic, t]) => { const r = h(`<div class="check-row"><div class="ci" data-ic="${ic}"></div><div class="grow"><small style="color:var(--text);font-size:13.5px"></small></div></div>`); r.querySelector('small').textContent = t; ul.append(r); });
    if (busy) { qa.append(setupProgressEl(S.course.name)); p.append(wrap); return; }
    const go = h(`<button class="primary big" style="margin-top:8px"><span data-ic="download"></span>הורד הכל והתחל להכין</button>`);
    icons(go);
    go.disabled = !!busy;
    go.onclick = () => {
      // One request does it all, in order: Moodle, then CS24, then the study material.
      S.setupRunning = S.setupRunning || {}; S.setupRunning[S.course.name] = true;
      send({ type: 'setupRun', course: S.course.name, sections: plainSections(), cs24: !!ans.cs24Auto });
      renderSetup();
      toast('מוריד את כל החומר. אפשר בינתיים להגדיר קורס אחר.', { ms: 5000 });
    };
    const back = h('<button class="ghost" style="margin-top:8px">שנה תשובות</button>');
    back.onclick = () => { S.setupAns[S.course.name] = {}; renderSetup(); };
    ul.append(h('<div class="row wrap"></div>'));
    ul.lastChild.append(go, back);
    qa.append(ul);
  }
  p.append(wrap);
}

// ---------- Recordings of the course ----------
function renderRecs() {
  const p = $('pane-recs'); p.innerHTML = '';
  const zoomTool = S.sections.flatMap(s => s.items).find(i => i.mod === 'lti' && /zoom|זום/i.test(i.name));
  if (false && zoomTool) {
    const c = h(`<div class="card pad-lg" style="margin-bottom:14px"><div class="row" style="gap:14px"><span class="ic zoom" data-ic="video"></span>
      <div class="grow"><b>הקלטות הזום של הקורס</b><div class="muted" style="font-size:12.5px">נפתח את עמוד הזום של הקורס כאן באפליקציה. נכנסים ל-Cloud Recordings, בוחרים שיעור ולוחצים להורדה. ההקלטה נשמרת בתיקיית ההקלטות של הקורס.</div></div>
      <button class="primary">פתח את הקלטות הזום</button></div></div>`);
    c.querySelector('button').onclick = () => { $('dlCourse').value = S.course.name; $('dlFolder').value = 'הקלטה'; syncDownloadTarget(); openSite('moodle', zoomTool.url); };
    p.append(c);
  }
  // Paste a lecture's Zoom link: "הרצאה N" + its transcript go to the course's "הקלטות" folder.
  const addCard = h(`<div class="card pad-lg" style="margin-bottom:14px"><h2>הוסף הקלטה של הרצאה</h2>
    <p class="muted" style="margin:6px 0 12px">הדבק את הקישור ל-Zoom. מספר ההרצאה כבר מוכן, ואפשר לשנות אותו.</p></div>`);
  addCard.append(h('<p>פתח הרצאה בלשונית הרצאות ולחץ על הוסף הקלטה. אפשר לבחור גם שם לקובץ.</p>'));
  p.append(addCard);
  // Only recordings that really exist: downloaded, or downloading now.
  const lectures = []; // Legacy course-level media is not automatically labelled as a lecture recording.
  const lessonRecs = S.sections.filter(s => s.local && s.local.videos);
  const busy = [...S.jobs.values()].filter(j => j.course === S.course.name && (j.state === 'running' || j.state === 'queued' || j.state === 'failed'));
  if (!lectures.length && !lessonRecs.length && !busy.length) {
    p.append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>עוד אין הקלטות</b>הדבק למעלה קישור להקלטה של הרצאה. בלי הקלטות הכל עובד גם כן, רק בלי התמלול.</div>`));
    return;
  }
  const list = h('<div class="card pad-lg"><h2>ההקלטות של הקורס</h2><div class="rec-list" style="margin-top:12px;display:grid;gap:8px"></div></div>');
  busy.forEach(j => {
    const row = h(`<div class="check-row"><div class="ci">${j.state === 'failed' ? IC.alert : '<span class="spinner"></span>'}</div><div class="grow"><b dir="auto"></b><small dir="auto"></small></div></div>`);
    row.querySelector('b').textContent = j.name; row.querySelector('small').textContent = j.status;
    if (j.state === 'failed') { const b = h('<button class="small">נסה שוב</button>'); b.onclick = () => send({ type: 'retry', id: j.id }); row.append(b); }
    list.querySelector('.rec-list').append(row);
  });
  lectures.forEach(r => {
    const row = h(`<div class="check-row ok"><div class="ci" data-ic="check"></div><div class="grow"><b dir="auto"></b><small>קובץ הקלטה במחשב</small></div><button class="small">נגן</button></div>`);
    row.querySelector('b').textContent = r.name;
    row.querySelector('button').onclick = () => send({ type: 'openPath', path: r.path });
    list.querySelector('.rec-list').append(row);
  });
  lessonRecs.forEach(s => (s.local.recordings || []).forEach(rec => {
    const row = h('<div class="check-row ok"><div class="ci" data-ic="check"></div><div class="grow"><b dir="auto"></b><small></small></div><button class="small">נגן</button></div>');
    row.querySelector('b').textContent = 'הרצאה ' + s.num + ' · ' + rec.name;
    row.querySelector('small').textContent = rec.transcript ? 'הקלטה ותמלול במחשב' : 'הקלטה במחשב · ללא תמלול';
    row.querySelector('button').onclick = () => send({type:'openPath',path:rec.path});
    list.querySelector('.rec-list').append(row);
  }));
  p.append(list);
}

function renderCourseHeader() {
  const L = S.local || {};
  const n = S.sections.filter(s => s.num > 0).length;
  $('courseCount').textContent = n === 1 ? 'הרצאה אחת' : n + ' הרצאות';
  $('tabLessons').textContent = n;
  $('tabExams').textContent = L.exams || 0;
  $('tabNotes').textContent = L.notes || 0;
  $('courseReady').hidden = !(L.lecturePdfs || L.studyPages);
  $('courseReady').textContent = (L.studyPages || L.lecturePdfs) ? ((L.studyPages || L.lecturePdfs) === 1 ? 'סיכום אחד מוכן' : (L.studyPages || L.lecturePdfs) + ' סיכומים מוכנים') : '';
  applyBg($('courseHero'), L.background);
}

// A summary that is being made: kept on the app's side, so it is still there when the student comes back to the course.
const lectureState = (row) => ({ aiBusy: !!row.running, pct: row.progress ? row.progress.pct : null, eta: row.progress ? row.progress.eta : null, pctText: row.progress ? row.progress.text : '' });

function requestLectureSummary(course, lecture, force=false) {
  if (document.querySelector('.summary-options')) return;
  const dialog=h(`<dialog class="summary-options" dir="rtl" aria-labelledby="summaryOptionsTitle"><form method="dialog"><h2 id="summaryOptionsTitle">${force?'בנייה מחדש':'יצירת סיכום'} · הרצאה ${esc(String(lecture.num))}</h2><p class="muted">הסיכום יתמקד בפתרון שיעורי הבית: השאלות המלאות, ההסברים הנחוצים והפתרונות המודרכים. מבחני עבר ופתרונות שתוסיפו באזור המבחנים יעזרו למקד את ההכנה למבחן. ההערות שלך קובעות על אילו מקורות להתבסס וכמה לפרט; הסיכום יישאר בגבולות ההרצאה.</p><label>הערות לסיכום <small class="muted">(לא חובה)</small><textarea name="notes" rows="6" maxlength="4000" placeholder="למשל: להתבסס בעיקר על מחברות התלמיד והמרצה; לסכם רק מה שנלמד בהרצאה ולהשלים רק מה שחיוני לתרגילים."></textarea></label><p class="muted">ההערות נשמרות להרצאה. שינוי בהן יילקח בחשבון גם אם קבצי ההרצאה לא השתנו.</p><div class="row"><button type="submit" class="primary">${force?'בנה מחדש':'צור סיכום'}</button><button type="button" class="ghost" data-cancel>ביטול</button></div></form></dialog>`);
  dialog.querySelector('textarea').value=lecture.summaryNotes||'';
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const notes=dialog.querySelector('textarea').value.trim();lecture.summaryNotes=notes;send({type:'lecturePdf',course:course.name,num:lecture.num,title:lecture.title,force,notes});dialog.close();};
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();dialog.querySelector('textarea').focus();
}

function renderLectures() {
  const box = $('lectures'); box.innerHTML = '';
  if (examsIntroNeeded()) box.append(examsIntroCard());
  box.append(newLectureBar(), lectureCalendarEditor());
  const secs = S.sections;
  if (!secs.length) { box.append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>התחל מהרצאה 1</b>צור הרצאה ובחר את המצגות, שיעורי הבית ודפי המחברת שלה. חומר מגרסאות קודמות נשאר בתיקיית הקורס ואפשר לייבא אותו מכפתורי הוספת הקבצים.</div>`)); return; }
  secs.forEach((s, i) => { const el = lectureEl(s); el.style.setProperty('--i', i); box.append(el); });
  box.classList.add('stagger');
}

function lectureEl(s) {
  const el = h(`<div class="lecture" data-num="${s.num}">
    <div class="lecture-head"><div class="num"></div><div class="lecture-main"><div class="lecture-title" dir="auto"></div><div class="chips"></div></div><span class="chevron" data-ic="forward" style="transform:rotate(-90deg)"></span></div>
    <div class="lecture-body"><div><div class="lecture-inner"><div class="top-actions"></div><ul class="items"></ul><div class="actions"></div><div class="notebook-hint"></div><div class="status"></div><div class="ai-log"></div></div></div></div></div>`);
  el.querySelector('.chevron').style.transform = '';
  el.querySelector('.chevron').innerHTML = svgI('<path d="m6 9 6 6 6-6"/>');
  el.querySelector('.lecture-head').onclick = () => { el.classList.toggle('open'); el.classList.contains('open') ? S.open.add(s.num) : S.open.delete(s.num); };
  if (S.open.has(s.num)) el.classList.add('open');
  fillLecture(el, s);
  return el;
}

function fillLecture(el, s) {
  const L = s.local || {};
  const course = S.course;
  const files = L.materialFiles || [];
  const inHomework = (f) => f.name.startsWith('תרגילים\\');
  const hasMaterial = files.some(f => !inHomework(f) && !f.name.startsWith('מחברת תלמיד\\'));
  const hasHomework = files.some(inHomework) || (L.exercises || 0) > 0;
  const hasNotes = files.some(f => f.name.startsWith('מחברת תלמיד\\'));
  // Solutions (official ones from the lecturer or TA) let the summary check every answer instead of guessing.
  const hasSolutions = files.some(f => inHomework(f) && /פתרון|solution|solut|(^|[\\_ .\-])sol([\\_ .\-\d]|$)/i.test(f.name));
  const recs = L.recordings || [];
  el.classList.toggle('ready', !!(L.lecturePdf || L.studyPage));
  el.querySelector('.num').textContent = s.num === 0 ? '★' : s.num;
  el.querySelector('.lecture-title').textContent = s.num === 0 ? 'כללי · ' + s.title : s.title;
  const chips = [];
  if (hasMaterial) chips.push('<span class="chip ok">מצגות ✓</span>');
  if (hasHomework) chips.push('<span class="chip ok">שיעורי בית ✓</span>');
  if (hasNotes) chips.push('<span class="chip ok">מחברת ✓</span>');
  if (recs.length) chips.push('<span class="chip ok">הקלטה ✓</span>');
  if (L.lecturePdf) chips.push('<span class="chip ok">סיכום PDF מוכן ✓</span>');
  else if (L.studyPage) chips.push('<span class="chip ok">סיכום מוכן ✓</span>');
  el.querySelector('.chips').innerHTML = chips.join('');
  el.querySelector('.quick-summary')?.remove();
  const quickPage=L.studyPage||(L.sharedSummaries||[])[0]?.path;
  if(quickPage){const quick=h('<button class="primary small quick-summary">פתח סיכום</button>');quick.onclick=e=>{e.stopPropagation();openViewer(quickPage,'הרצאה '+s.num+' · סיכום',L.lecturePdf||'',s.num);};el.querySelector('.lecture-head').insertBefore(quick,el.querySelector('.chevron'));}

  const items = el.querySelector('.items');
  items.innerHTML = '';
  items.append(h(`<li class="muted">${s.date ? 'תאריך הרצאה: ' + esc(s.date) : 'תאריך הרצאה לא הוגדר'} · ${s.due ? 'הגשת שיעורי בית: ' + esc(s.due) : 'מועד הגשה לא ידוע'}</li>`));
  files.forEach(file => {
    const li = h('<li><span class="ic file" data-ic="file"></span><span class="nm" dir="auto"></span><button class="small ghost">פתח</button></li>');
    li.querySelector('.nm').textContent = file.name;
    li.querySelector('button').onclick = () => send({ type: 'openPath', path: file.path }); items.append(li);
  });
  // The recording is listed with the files, together with its transcript.
  recs.forEach(r => {
    const li = h('<li><span class="ic zoom" data-ic="play"></span><span class="nm" dir="auto"></span><span class="kind"></span><button class="small ghost">נגן</button></li>');
    li.querySelector('.nm').textContent = 'הקלטה\\' + r.name + (r.ext || '.mp4');
    li.querySelector('.kind').textContent = r.transcript ? 'עם תמלול' : '';
    li.querySelector('button').onclick = () => send({ type: 'openPath', path: r.path }); items.append(li);
  });

  const a = el.querySelector('.actions'); a.innerHTML = '';
  const btn = (ic, text, cls, fn, disabled) => { const b = h(`<button class="${cls}"><span data-ic="${ic}"></span>${text}</button>`); b.onclick = (e) => { e.stopPropagation(); fn(); }; b.disabled = !!disabled; a.append(b); return b; };
  // A button turns green when its part of the lecture already has something in it.
  const recRow = () => {
    const open = el.querySelector('.rec-row');
    if (open) { open.remove(); return; }
    const row = lectureLinkRow(null, s.num); row.classList.add('rec-row'); el.querySelector('.actions').after(row);
    row.querySelector('input.ltr').focus();
  };
  const top = el.querySelector('.top-actions'); top.innerHTML = '';
  const topRec = h(`<button class="${recs.length ? 'done' : 'soft'} small"><span data-ic="video"></span>${recs.length ? 'הקלטה נוספה ✓' : 'הוסף הקלטה'}</button>`);
  topRec.onclick = (e) => { e.stopPropagation(); recRow(); };
  top.append(topRec);
  top.append(h('<small class="muted">לא לכל הקורס יש הקלטה, זה לא חובה.</small>'));

  btn('book', 'מצגות וחומר מה-Moodle', hasMaterial ? 'done' : 'soft', () => lectureSource(s.num, 'moodle', 'slides'));
  btn('exam', 'שיעורי בית ופתרונות מה-Moodle', hasHomework ? 'done' : 'soft', () => lectureSource(s.num, 'moodle', 'homework'));
  btn('book', 'חומר מ-CS24', 'ghost', () => lectureSource(s.num, 'cs24', 'slides'));
  btn('plus', 'קבצים מהמחשב', 'ghost', () => send({ type: 'addFiles', course: course.name, folder: String(s.num), kind: '' }));
  btn('plus','סיכום של חבר (ZIP / OneDrive)','soft',()=>showSummaryImport(course.name,s.num));
  (L.sharedSummaries||[]).forEach(item=>btn('book','סיכום חבר: '+item.title,'soft',()=>openViewer(item.path,item.title,'',s.num)));
  btn('calendar', 'ערוך תאריכים וכותרת', 'ghost', () => {
    const existing = el.querySelector('.lecture-editor');
    if (existing) { existing.remove(); return; }
    el.querySelector('.actions').after(lectureEditor(s));
  });
  // The main thing per lecture: the summary with the homework (how to answer, and where each question comes from).
  if (s.aiBusy) btn('x', 'עצור', 'danger', () => send({ type: 'cancelAi', key: `sum|${course.name}|${s.num}` }));
  else if (s.num > 0 && (L.lecturePdf || L.studyPage)) {
    // The summary opens inside the app (with the chat next to it for questions); the PDF is a file in the lecture's folder.
    btn('book', 'פתח את הסיכום', 'primary', () => openViewer(L.studyPage || L.lecturePdf, `הרצאה ${s.num} · סיכום`, L.lecturePdf, s.num));
    if (L.lecturePdf) btn('file', 'פתח כ-PDF', 'soft', () => send({ type: 'openPath', path: L.lecturePdf }));
    btn('sparkles', 'עדכן סיכום אם החומר השתנה', 'soft', () => requestLectureSummary(course, s), s.busy);
    // Another AI (ChatGPT / Gemini on the student's account) checks every solution in the summary and adds its notes at the end.
    if (helpersConnected()) btn('check', 'בדיקה שנייה עם AI נוסף', 'soft', () => send({ type: 'secondOpinion', course: course.name, num: s.num }), s.busy);
    btn('refresh', 'בנה מחדש מההתחלה', 'ghost', () => requestLectureSummary(course, s, true), s.busy);
  } else if (s.num > 0) btn('sparkles', 'צור סיכום PDF של ההרצאה', L.files || L.transcripts ? 'primary' : 'soft',
    () => requestLectureSummary(course, s), s.busy || !(L.files || L.transcripts));
  if (L.exists) btn('folder', 'תיקייה', 'ghost', () => send({ type: 'openPath', path: L.dir }));
  if (s.num > 0) btn('chat', 'שאל על השיעור', 'ghost', () => setChatScope('lesson:' + s.num));

  // Notebooks come from the student's own app: they export a PDF into the lecture's folder in OneDrive and it is noticed there.
  const hint = el.querySelector('.notebook-hint'); hint.innerHTML = '';
  // Homework: say why the solutions matter, and whether they are there.
  const hw = h(`<div class="hw-hint ${hasHomework ? 'ok' : 'warn'}"><span class="ic" data-ic="${hasHomework ? 'check' : 'alert'}"></span><div class="grow"></div></div>`);
  const hwText = hw.querySelector('.grow');
  if (!hasHomework) hwText.innerHTML = '<b>יש שיעורי בית להרצאה הזו?</b> הוסף אותם <b>יחד עם הפתרונות</b> (של המרצה או המתרגל). הפתרונות הם מה שמאפשר לסכם את שיעורי הבית בלי טעויות, וללמוד איך המרצה שלך עונה.';
  else if (!hasSolutions) hwText.innerHTML = '<b>זוהו שיעורי בית.</b> אם בין הקבצים יש גם פתרונות של המרצה או המתרגל (גם אם השם שלהם לא מכיל "פתרון"), ה-AI ישתמש בהם ויתאים אליהם את הסיכום. אם אין, הוא יפתור לבד ויסמן שהפתרון לא אומת מול פתרון רשמי.';
  else hwText.innerHTML = '<b>זוהו שיעורי בית עם פתרונות ✓</b> הסיכום ייבדק מולם.';
  if (!hasHomework) {
    const row = h('<div class="row wrap" style="margin-top:8px"></div>');
    const b1 = h('<button class="soft small"><span data-ic="book"></span>פתרונות מה-Moodle</button>'); b1.onclick = () => lectureSource(s.num, 'moodle', 'homework');
    const b2 = h('<button class="ghost small"><span data-ic="plus"></span>מהמחשב</button>'); b2.onclick = () => send({ type: 'addFiles', course: course.name, folder: String(s.num), kind: 'homework' });
    row.append(b1, b2); hwText.append(row);
  }
  icons(hw); hint.append(hw);
  hint.append(h(`<div class="muted" style="font-size:12.5px;margin-top:10px">יש לך מחברת (Notability או אחרת)? ייצא אותה ל-PDF ושמור בתיקיית "מחברת תלמיד" של ההרצאה - האפליקציה מזהה אותה לבד ומשתמשת בה בסיכום. ${hasNotes ? '<b>זוהתה מחברת ✓</b>' : ''}</div>`));
  const nb = h('<button class="link">פתח את תיקיית מחברת תלמיד</button>');
  nb.onclick = () => send({ type: 'openPath', path: L.dir + '\\מחברת תלמיד' });
  hint.append(nb);

  paintStatus(el, s);
}
// The status line of a lecture; while a summary is being made it shows a bar with a percentage and a rough time left.
function paintStatus(el, s) {
  const L = s.local || {};
  const job = lessonJob(s.num);
  const st = el.querySelector('.status'); if (!st) return;
  const working = s.busy || s.aiBusy;
  st.className = 'status' + (s.statusError || (job && job.state === 'failed') ? ' error' : '');
  const text = (working && s.pctText) || s.status || (job ? 'הקלטה: ' + job.status : '') || (!L.files && s.items.length ? 'בחר והוסף את הקבצים השייכים להרצאה זו.' : '');
  let bar = '';
  if (working && s.pct != null) {
    const eta = s.eta == null ? '' : s.eta < 0 ? ' · עוד קצת סבלנות, זה כמעט שם' : s.eta <= 45 ? ' · פחות מדקה' : ` · נשארו בערך ${Math.round(s.eta / 60)} דקות`;
    bar = `<div class="sum-progress"><div class="row"><b>${s.pct}%</b><span class="muted">${esc(eta.replace(/^ · /, ''))}</span></div><div class="bar big"><i style="width:${s.pct}%"></i></div></div>`;
  }
  if (!bar && job && job.state === 'running' && job.progress >= 0) bar = `<div class="sum-progress"><div class="row"><b>${job.progress}%</b><span class="muted">מוריד את ההקלטה</span></div><div class="bar big"><i style="width:${job.progress}%"></i></div></div>`;
  st.innerHTML = (working ? '<span class="spinner"></span>' : (job && job.state !== 'failed' ? '<span class="spinner"></span>' : '')) + `<span dir="auto">${esc(text)}</span>` + bar;
}
function section(num) { return S.sections.find(s => s.num === num); }
function refreshSection(num) {
  const s = section(num); if (!s) return;
  const el = document.querySelector(`.lecture[data-num="${num}"]`);
  if (el) fillLecture(el, s); else renderLectures();
}

function courseStatus(text, busy, error, pct) {
  const b = $('courseStatus');
  b.hidden = !text;
  b.className = 'status-bar' + (error ? ' error' : '') + (pct != null && busy ? ' has-progress' : '');
  b.innerHTML = (busy ? '<span class="spinner"></span>' : error ? IC.alert : '') + `<span dir="auto" class="grow">${esc(text || '')}</span>`
    + (pct != null && busy ? `<b class="pct">${pct}%</b><div class="bar"><i style="width:${pct}%"></i></div>` : '');
}

// The setup screen while the course downloads: a big bar, what is happening now, and a nudge to use the time.
function setupProgressEl(course) {
  const p = (S.progress && S.progress[course]) || { pct: 0, text: 'מתחיל להוריד...' };
  const el = h(`<div class="setup-progress" id="setupProgress">
    <div class="row"><b class="grow">מוריד את החומר של הקורס</b><b class="pct">${p.pct}%</b></div>
    <div class="bar big"><i style="width:${p.pct}%"></i></div>
    <div class="muted now" dir="auto"></div>
    <div class="tip"><span data-ic="sparkles"></span><div><b>זה לוקח כמה דקות, וזה בסדר.</b><br>בינתיים אפשר להתחיל את אותו תהליך בקורס אחר, וההורדה כאן תמשיך ברקע. כשהכל יהיה מוכן אשלח לך הודעה.</div></div>
    <button class="primary" id="otherCourse"><span data-ic="book"></span>בינתיים, לקורס הבא</button></div>`);
  el.querySelector('.now').textContent = p.text;
  el.querySelector('#otherCourse').onclick = () => show('courses');
  icons(el);
  return el;
}

function updateSetupProgress(course) {
  const el = $('setupProgress');
  if (!el || !S.course || S.course.name !== course) return;
  const p = S.progress[course];
  el.querySelector('.pct').textContent = p.pct + '%';
  el.querySelector('.bar i').style.width = p.pct + '%';
  el.querySelector('.now').textContent = p.text;
}

function renderInfo() {
  const p = $('pane-info'); p.innerHTML = '';
  const L = S.local || {};
  const info = L.info;
  const busy = S.infoBusy;
  if (!info) {
    p.append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>עוד אין מידע על הקורס</b>
      לחיצה אחת, והאפליקציה מסנכרנת את הסילבוס מה-Moodle וקוראת אותו: מרצה, הרכב הציון, האם שיעורי הבית חובה, מבנה המבחן ותאריכים חשובים.
      <div class="row"><button class="primary" id="sylBtn"><span data-ic="refresh"></span>לחץ כאן כדי לסנכרן את הסילבוס</button>
      <button class="ghost" id="addSyl"><span data-ic="plus"></span>הוסף סילבוס מהמחשב</button></div></div>`));
    $('sylBtn').disabled=!!busy; if(busy)$('sylBtn').textContent='מסנכרן וקורא את הסילבוס...';
    $('sylBtn').onclick = () => downloadMoodle('syllabus');
    $('addSyl').onclick = () => send({ type: 'addFiles', course: S.course.name, folder: 'מידע על הקורס' });
    return;
  }
  const hw = info.homeworkRequired === true ? ['bad', 'חובה'] : info.homeworkRequired === false ? ['ok', 'לא חובה'] : ['', 'לא צוין'];
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444'];
  const grading = (info.grading || []).filter(g => g && g.component);
  const total = grading.reduce((a, g) => a + (+g.weight || 0), 0) || 1;
  const wrap = h('<div class="stagger"></div>');
  wrap.append(h(`<div class="info-grid">
    <div class="card stat" style="--i:0"><span class="si ic zoom" data-ic="user"></span><div><small>מרצה</small><b dir="auto">${esc(info.lecturer || $('lecturer').value || 'לא צוין')}</b>${info.officeHours ? `<small dir="auto">שעות קבלה: ${esc(info.officeHours)}</small>` : ''}</div></div>
    <div class="card stat" style="--i:1"><span class="si ic assign" data-ic="exam"></span><div><small>שיעורי בית</small><b><span class="chip ${hw[0]}">${hw[1]}</span></b>${info.homeworkNote ? `<small dir="auto">${esc(info.homeworkNote)}</small>` : ''}</div></div>
    <div class="card stat" style="--i:2"><span class="si ic file" data-ic="calendar"></span><div><small>מבנה המבחן</small><b dir="auto" style="font-size:13.5px">${esc(info.examFormat || 'לא צוין')}</b>${info.materialsAllowed ? `<small dir="auto">חומר עזר: ${esc(info.materialsAllowed)}</small>` : ''}</div></div>
    ${info.attendance ? `<div class="card stat" style="--i:3"><span class="si ic other" data-ic="check"></span><div><small>נוכחות</small><b dir="auto" style="font-size:13.5px">${esc(info.attendance)}</b></div></div>` : ''}
  </div>`));
  if (grading.length) {
    const c = h(`<div class="card" style="margin-top:14px;--i:4"><h2>הרכב הציון</h2><div class="grade-bar">${grading.map((g, i) => `<span style="flex-grow:${+g.weight || 0};background:${colors[i % colors.length]}"></span>`).join('')}</div>
      <div class="legend">${grading.map((g, i) => `<div><i style="background:${colors[i % colors.length]}"></i><span dir="auto">${esc(g.component)}</span><b>${esc(g.weight)}%</b></div>`).join('')}</div></div>`);
    wrap.append(c);
  }
  const dates = S.sections.filter(s => s.due).map(s => ({date:s.due,what:'הגשת שיעורי בית · הרצאה ' + s.num})).concat((S.timetable && S.timetable.exams || []).filter(e => e.course && S.course.name.includes(e.course)).map(e => ({date:e.date,what:'מבחן · מועד ' + (e.moed || '')})));
  if (dates.length) wrap.append(h(`<div class="card" style="margin-top:14px;--i:5"><h2>תאריכים מהמערכת ומההרצאות שהגדרת</h2><div class="dates-list" style="margin-top:8px">${dates.map(d => `<div><b class="ltr">${esc(d.date || '')}</b><span dir="auto">${esc(d.what)}</span></div>`).join('')}</div></div>`));
  const tips = (info.tips || []).filter(Boolean);
  if (tips.length) wrap.append(h(`<div class="card" style="margin-top:14px;--i:6"><h2>טיפים לקורס</h2><ul class="tips">${tips.map(t => `<li dir="auto">${esc(t)}</li>`).join('')}</ul></div>`));
  const row = h('<div class="row wrap" style="margin-top:14px"></div>');
  const sy = h(`<button class="soft"><span data-ic="download"></span>הורד סילבוס מה-Moodle מחדש</button>`); sy.disabled=!!busy; sy.onclick = () => downloadMoodle('syllabus'); row.append(sy);
  const r = h(`<button class="ghost"><span data-ic="refresh"></span>נתח מחדש</button>`); r.disabled = busy; r.onclick = () => { S.infoBusy = true; send({ type: 'analyzeCourse', course: S.course.name }); renderInfo(); }; row.append(r);
  wrap.append(row);
  p.append(wrap);
}

function renderExams() {
  const p = $('pane-exams'); p.innerHTML = '';
  const L = S.local || {};
  const busy = S.examBusy;
  const card = h(`<div class="card pad-lg">
    <div class="row" style="align-items:flex-start;gap:18px"><div style="width:150px;flex:none">${ART.chat().replace('<svg', '<svg style="width:150px;height:104px"')}</div>
    <div class="grow"><h2>הכנה למבחן</h2><p class="muted" style="margin:6px 0 14px">מוסיפים מבחנים משנים קודמות, עדיף עם פתרונות. ${aiName()} קורא אותם יחד עם ההרצאות והתרגילים ומבין אילו נושאים חוזרים, איזה שאלות המרצה נותן ואיך הוא רוצה שתפתור. בסוף מקבלים דף הכנה למבחן, ואפשר להתאמן בשאלות בסגנון שלו.</p>
    <div class="row wrap"><span class="chip ${L.exams ? 'ok' : ''}">${L.exams || 0} קבצי מבחנים</span>${L.lecturerProfile ? '<span class="chip ok">פרופיל מרצה מוכן ✓</span>' : ''}${L.examPrep ? '<span class="chip ok">דף הכנה מוכן ✓</span>' : ''}</div></div></div>
    <div class="row wrap" style="margin-top:18px" id="examActs"></div></div>`);
  p.append(card);
  const acts = card.querySelector('#examActs');
  const add = (ic, t, cls, fn, dis) => { const b = h(`<button class="${cls}"><span data-ic="${ic}"></span>${t}</button>`); b.onclick = fn; b.disabled = !!dis; acts.append(b); };
  add('download', 'הורד את כל המבחנים מה-Moodle', 'primary', () => downloadMoodle('exams'), runtimeFor(S.course.name).operations.get('exams'));
  add('exam', 'מבחנים מ-CS24', 'soft', () => { setSaveTarget(S.course.name, 'מבחנים'); openSite('cs24'); toast('כל קובץ שתוריד מ-CS24 יישמר בתיקיית המבחנים של הקורס'); });
  add('plus', 'הוסף מבחנים מהמחשב', 'ghost', () => send({ type: 'addFiles', course: S.course.name, folder: 'מבחנים' }));
  if (L.exams) add('folder', 'תיקיית המבחנים', 'ghost', () => send({ type: 'openPath', path: L.dir + '\\מבחנים' }));
  add('sparkles', busy ? 'עובד על זה...' : (L.examPrep ? 'בנה מחדש את דף ההכנה' : 'בנה דף הכנה למבחן'), 'primary', () => { S.examBusy = true; send({ type: 'examPrep', course: S.course.name }); renderExams(); }, busy || !L.exams);
  add('chat', 'התאמן בשאלות', 'soft', () => setChatScope('exam'), !L.exams);
  if (L.examPrep) add('external', 'דף ההכנה למבחן', 'primary', () => send({ type: 'openPath', path: L.examPrep }));
  if (L.lecturerProfile) add('user', 'פרופיל המרצה', '', () => send({ type: 'openPath', path: L.lecturerProfile }));
}

// Notability's own site inside the app: sign in once, open a note, and "Export as PDF" saves it into this course.
function notabilityWebButton() {
  const card = h(`<div class="card" style="margin-top:14px"><div class="row" style="gap:14px"><span class="ic other" data-ic="note"></span>
    <div class="grow"><b>או ישר מהחשבון שלך ב-Notability</b><div class="muted" style="font-size:12.5px">פותחים את Notability בתוך האפליקציה ומתחברים לחשבון. כל מחברת שמייצאים ל-PDF נשמרת לבד בתיקיית המחברת של הקורס.</div></div>
    <button class="primary">פתח את Notability</button></div></div>`);
  card.querySelector('button').onclick = () => { $('dlCourse').value = S.course.name; $('dlFolder').value = 'מחברת'; syncDownloadTarget(); openSite('notability'); };
  return card;
}

function renderNotes() {
  const p = $('pane-notes'); p.innerHTML = '';
  const general = h('<div class="card pad-lg"><h2>דפי המחברת שלך מכל אפליקציה</h2><p>ייצא PDF מ-Notability, מ-Goodnotes או מכל אפליקציית כתיבה. פתח הרצאה ולחץ על דפי מחברת כדי לכלול אותם בסיכום שלה.</p><button class="primary">בחר הרצאה להוספת מחברת</button></div>'); general.querySelector('button').onclick = () => setTab('lessons'); p.append(general);
  const N = S.notability || {};
  const L = S.local || {};
  if (!N.configured) {
    p.append(h(`<div class="empty">${ART.folders().replace('<svg', '<svg class="art" style="width:200px;height:120px"')}<b>חבר את המחברת מ-Notability</b>
      ב-Notability באייפד: הגדרות › גיבוי אוטומטי › Google Drive / OneDrive / Dropbox, בפורמט PDF.<br>כשהתיקייה מסונכרנת למחשב, בחר אותה כאן. המחברות של הקורס ייכנסו לסיכומים ולצ'אט.
      <div class="row"><button class="primary" id="pickNot"><span data-ic="folder"></span>בחר את תיקיית הגיבוי</button></div></div>`));
    $('pickNot').onclick = () => send({ type: 'chooseFolder', which: 'notability' });
    p.append(notabilityWebButton());
    return;
  }
  const opts = ['<option value="">בחר את הנושא ב-Notability...</option>'].concat((N.subjects || []).map(s => `<option ${s === (N.linked || N.guess) ? 'selected' : ''}>${esc(s)}</option>`)).join('');
  const card = h(`<div class="card pad-lg"><div class="row" style="gap:18px;align-items:flex-start"><div style="width:150px;flex:none">${ART.folders().replace('<svg', '<svg style="width:150px;height:96px"')}</div>
    <div class="grow"><h2>המחברת שלי</h2><p class="muted" style="margin:6px 0 14px">בחר את הנושא ב-Notability שמתאים לקורס. כל דף חדש שתכתוב בהרצאה יועתק לכאן לבד, ו-${aiName()} ישתמש בו בסיכומים.</p>
    <div class="row"><select id="notSubject">${opts}</select><button class="primary" id="notLink">${N.linked ? 'עדכן' : 'קשר'}</button></div>
    <div class="row wrap" style="margin-top:12px">${N.linked ? `<span class="chip ok">מקושר ל"${esc(N.linked)}"</span>` : N.guess ? `<span class="chip accent">הצעה: ${esc(N.guess)}</span>` : ''}<span class="chip">${N.notes || 0} דפי מחברת</span></div></div></div></div>`);
  p.append(card);
  $('notLink').onclick = () => send({ type: 'linkNotability', course: S.course.name, folder: $('notSubject').value });
  p.append(notabilityWebButton());
  if (N.notes) { const b = h('<button class="ghost" style="margin-top:12px"><span data-ic="folder"></span>פתח את המחברת</button>'); b.onclick = () => send({ type: 'openPath', path: L.dir + '\\מחברת' }); p.append(b); }
}

// ---------- Chat ----------
// Each course has separate conversations: the whole course, each lesson ("lesson:N"), and exam practice ("exam").
S.chatScope = 'course';
S.chatLogs = {};
function scopeTitle(scope) {
  if (scope === 'exam') return 'אימון למבחן';
  if (scope.startsWith('lesson:')) return 'הרצאה ' + scope.slice(7);
  return 'כל הקורס';
}
function setChatScope(scope) {
  if (S.chatBusy) return toast('רגע, העוזר עוד עונה');
  S.chatScope = scope;
  if (S.chatHidden) $('toggleChat').click();
  resetChat();
  (S.chatLogs[scope] || []).forEach(x => addMsg(x.role, x.text, true));
  if (scope === 'exam' && !(S.chatLogs.exam || []).length) { $('chatText').value = 'בוא נתחיל אימון. תן לי שאלה ראשונה בסגנון המבחנים של המרצה.'; }
  $('chatText').focus();
}
function resetChat() {
  const scope = S.chatScope;
  $('chatTitle').textContent = 'שאלות על החומר · ' + scopeTitle(scope);
  $('chatSub').textContent = `${aiName()} · ${scope === 'exam' ? 'שואל אותך שאלות בסגנון המבחנים' : 'מכיר את כל החומר שהורד'}`;
  $('chatBack').hidden = scope === 'course';
  $('msgs').innerHTML = '';
  const intro = scope === 'exam' ? '<b>אימון למבחן</b>אני אשאל אותך שאלות בסגנון של המרצה, לפי המבחנים הקודמים, ואבדוק את התשובות שלך.'
    : scope.startsWith('lesson:') ? `<b>שיחה על ${scopeTitle(scope)}</b>שאל על החומר של השיעור, על התרגיל או על מה שלא היה ברור בהרצאה.`
    : '<b>שאל אותי כל דבר על הקורס</b>אני קורא את המצגות, התרגילים, התמלולים והמבחנים. אם חסר משהו, אגיד לך בדיוק מאיפה להביא אותו.';
  const e = h(`<div class="chat-empty">${ART.chat().replace('<svg', '<svg class="art"')}${intro}<div class="suggest"></div></div>`);
  const qs = scope === 'exam' ? [['🎯', 'תן לי שאלה ראשונה בסגנון המבחנים של המרצה'], ['📊', 'מה הנושאים שהכי חוזרים במבחנים?']]
    : scope.startsWith('lesson:') ? [['📝', `תסכם לי את ${scopeTitle(scope)}`], ['💡', 'תעזור לי להתחיל את התרגיל של השיעור, רמזים בלבד'], ['❓', 'מה הכי חשוב לזכור מהשיעור הזה?']]
    : [['📝', 'מה למדנו עד עכשיו בקורס?'], ['🎯', 'מה הכי חשוב למבחן?'], ['🧭', 'מה עוד חסר לך כדי לעזור לי בקורס הזה?']];
  for (const [em, q] of qs) { const b = h(`<button class="ghost"></button>`); b.textContent = em + '  ' + q; b.onclick = () => { $('chatText').value = q; sendChat(); }; e.querySelector('.suggest').append(b); }
  $('msgs').append(e);
}
function addMsg(role, text, replay) {
  const empty = $('msgs').querySelector('.chat-empty'); if (empty) empty.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + role; d.dir = 'auto';
  if (role === 'assistant') d.innerHTML = md(text); else d.textContent = text;
  $('msgs').append(d);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  if (!replay && role !== 'tool') (S.chatLogs[S.chatScope] = S.chatLogs[S.chatScope] || []).push({ role, text });
  return d;
}
// Under the last answer: a second AI (the other one connected) checks it, like a second pair of eyes.
function addCheckButton() {
  document.querySelectorAll('#msgs .msg-tools').forEach(x => x.remove());
  if (!helpersConnected() || !S.course || S.chatBusy) return;
  const last = [...document.querySelectorAll('#msgs .msg')].pop();
  if (!last || !last.classList.contains('assistant')) return;
  const tools = h('<div class="msg-tools"><button class="link small"><span data-ic="sparkles"></span>בדוק עם AI נוסף</button></div>');
  tools.querySelector('button').onclick = () => { tools.remove(); S.chatBusy = true; $('chatSend').disabled = true; setThinking('AI נוסף בודק...'); send({ type: 'chatCheck', course: S.course.name, scope: S.chatScope }); };
  last.after(tools);
  $('msgs').scrollTop = $('msgs').scrollHeight;
}
let thinking = null;
function setThinking(text) {
  if (!thinking) { thinking = addMsg('tool', ''); }
  thinking.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  thinking.append(document.createTextNode(text || 'חושב...'));
  $('msgs').scrollTop = $('msgs').scrollHeight;
}
function sendChat() {
  const text = $('chatText').value.trim();
  if (!text || S.chatBusy || !S.course) return;
  addMsg('user', text);
  $('chatText').value = ''; autosize();
  S.chatBusy = true; $('chatSend').disabled = true;
  setThinking('קורא את החומר...');
  send({ type: 'chat', course: S.course.name, scope: S.chatScope, text });
}
$('chatSend').onclick = sendChat;
$('chatText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
const autosize = () => { const t = $('chatText'); t.style.height = 'auto'; t.style.height = Math.min(170, t.scrollHeight) + 'px'; };
$('chatText').addEventListener('input', autosize);
$('newChat').onclick = () => { if (!S.course || S.chatBusy) return; send({ type: 'chatReset', course: S.course.name, scope: S.chatScope }); S.chatLogs[S.chatScope] = []; resetChat(); };
$('chatBack').onclick = () => setChatScope('course');

// ---------- Recordings ----------
const jobIcons = { queued: 'clock', running: 'spin', done: 'check', failed: 'alert' };
function renderJob(j) {
  S.jobs.set(j.id, j);
  if (j.course && S.course && S.course.name === j.course) refreshSection(j.num);
  let el = document.querySelector(`.job[data-id="${j.id}"]`);
  if (!el) {
    el = h(`<li class="job" data-id="${j.id}"><div class="job-top"><div class="badge-ic"></div><div class="job-main"><div class="job-name" dir="auto"></div><div class="job-status" dir="auto"></div></div><div class="job-buttons"></div></div>
      <div class="bar"><i></i></div><details><summary>פרטים</summary><pre class="log"></pre></details></li>`);
    $('jobs').prepend(el);
  }
  el.className = 'job ' + j.state;
  el.querySelector('.badge-ic').innerHTML = j.state === 'running' ? '<span class="spinner"></span>' : IC[jobIcons[j.state]] || '';
  el.querySelector('.job-name').textContent = j.name || 'הקלטת Zoom';
  el.querySelector('.job-status').textContent = j.status;
  const bar = el.querySelector('.bar');
  bar.classList.toggle('indeterminate', j.progress < 0);
  bar.querySelector('i').style.width = j.progress < 0 ? '' : j.progress + '%';
  const b = el.querySelector('.job-buttons'); b.innerHTML = '';
  const btn = (label, fn, cls = 'small') => { const x = h(`<button class="${cls}">${label}</button>`); x.onclick = fn; b.append(x); };
  if (j.hasVideo) btn(IC.play + 'נגן', () => send({ type: 'openFile', id: j.id, which: 'video' }));
  if (j.hasTranscript) btn(IC.file + 'תמלול', () => send({ type: 'openFile', id: j.id, which: 'transcript' }));
  if (j.hasVideo || j.hasTranscript) btn(IC.folder, () => send({ type: 'showFile', id: j.id }), 'small icon');
  if (j.state === 'failed') btn(IC.refresh + 'נסה שוב', () => send({ type: 'retry', id: j.id }));
  if (j.state === 'done' || j.state === 'failed') btn(IC.x, () => { send({ type: 'remove', id: j.id }); el.remove(); S.jobs.delete(j.id); refreshJobs(); }, 'small icon ghost');
  S.jobs.set(j.id, j);
  refreshJobs();
}
function refreshJobs() {
  const e = $('jobsEmpty'); e.innerHTML = '';
  if (!S.jobs.size) e.append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>אין הורדות עכשיו</b>הקלטה של שיעור מוסיפים מתוך השיעור, בכפתור "הוסף הקלטה".</div>`));
  const active = [...S.jobs.values()].filter(j => j.state === 'running' || j.state === 'queued').length;
  $('jobCount').hidden = !active; $('jobCount').textContent = active;
  $('navDownloads').hidden = true;   // recordings live inside each course now
  if (S.view === 'course' && S.tab === 'recs') renderRecs();
}
// The recording that is downloading for a lesson right now, if any.
function lessonJob(num) {
  if (!S.course) return null;
  return [...S.jobs.values()].reverse().find(j => j.course === S.course.name && j.num === num && (j.state === 'running' || j.state === 'queued' || j.state === 'failed')) || null;
}
function jobLog(id, line) {
  const pre = document.querySelector(`.job[data-id="${id}"] pre`); if (!pre) return;
  pre.textContent += line + '\n';
  const lines = pre.textContent.split('\n');
  if (lines.length > 300) pre.textContent = lines.slice(-300).join('\n');
  pre.scrollTop = pre.scrollHeight;
}

// ---------- Sites ----------
// A lecture summary inside the app: the page, with a way back to the lecture, to the chat and to the PDF.
function openViewer(path, title, pdf, lec) {
  S.viewer = { path, title, pdf, lec };
  $('summaryChat').hidden = true;
  $('viewerShareNote').hidden = true;
  $('viewerTitle').textContent = title;
  $('viewerPdf').hidden = !pdf;
  show('sites');
}
$('viewerBack').onclick = () => { S.viewer = null; show('course'); };
// The Gemini-only summary chat is connected in summary-chat.js.
$('viewerPdf').onclick = () => S.viewer && S.viewer.pdf && send({ type: 'openPath', path: S.viewer.pdf });
$('viewerShare').onclick = () => {
  if (!S.viewer || !S.course || S.shareJob?.busy) return;
  const requestId = 'share-' + Date.now();
  S.shareJob = { requestId, path: S.viewer.path, busy: true };
  $('viewerShare').disabled = true;
  $('viewerShareLabel').textContent = 'מכין ZIP…';
  $('viewerShareNote').hidden = false;
  $('viewerShareNote').classList.remove('error');
  $('viewerShareStatus').textContent = 'בחר היכן לשמור את קובץ ה־ZIP';
  send({ type: 'shareSummary', onedrive:!!S.shareToCloud, requestId, course: S.course.name, path: S.viewer.path, pdf: S.viewer.pdf || '', title: S.viewer.title });
};
$('viewerShareDismiss').onclick = () => { $('viewerShareNote').hidden = true; $('viewerShare').focus(); };
function summaryShareStatus(m) {
  if (!S.shareJob || S.shareJob.requestId !== m.requestId) return;
  if (m.type === 'summaryShareResult') {
    S.shareJob.busy = false;
    $('viewerShare').disabled = false;
    $('viewerShareLabel').textContent = 'שיתוף';
  }
  if (S.viewer?.path === S.shareJob.path && S.view === 'sites') {
    $('viewerShareNote').hidden = false;
    $('viewerShareNote').classList.toggle('error', m.status === 'error');
    $('viewerShareStatus').textContent = m.text;
  } else if (m.type === 'summaryShareResult' && m.status !== 'cancelled') toast(m.text, { error: m.status === 'error' });
}
$('siteBackCourse').onclick = () => { S.viewer = null; show('course'); };

function openSite(site, url) {
  $('summaryChat').hidden = true;
  $('viewerShareNote').hidden = true;
  if (window.stonesHook) window.stonesHook({ type: 'openSite', site });
  S.viewer = null;
  S.site = site;
  document.querySelectorAll('#siteTabs button').forEach(b => b.classList.toggle('active', b.dataset.site === site));
  S.siteUrl = url || null;
  show('sites');
  // A button that means a particular page (a course in Moodle) always lands there, not on the page the student left the site on.
  if (url) { const target = url; setTimeout(() => send({ type: 'siteNavigate', url: target }), 300); }
}
function placeSite(navigate) {
  if (S.view !== 'sites') return;
  const r = $('siteHost').getBoundingClientRect();
  const sideEl = document.querySelector('nav.side');
  const sideRect = sideEl ? sideEl.getBoundingClientRect() : null;
  // In RTL, nav.side is on the right side. Never let siteHost expand into nav.side.
  let allowedWidth = r.width;
  if (sideRect && sideRect.left > r.left) {
    allowedWidth = Math.min(r.width, Math.max(10, sideRect.left - r.left));
  }
  const m = { x: r.left, y: r.top, w: allowedWidth, h: r.height, vw: window.innerWidth };
  if (navigate && S.viewer) send(Object.assign({ type: 'viewFile', path: S.viewer.path }, m));
  else if (navigate) { send(Object.assign({ type: 'showSite', site: S.site, url: S.siteUrl || '' }, m)); S.siteUrl = null; }
  else send(Object.assign({ type: 'placeSite' }, m));
}
new ResizeObserver(() => placeSite(false)).observe($('siteHost'));
window.addEventListener('resize', () => placeSite(false));
document.querySelectorAll('#siteTabs button').forEach(b => b.onclick = () => openSite(b.dataset.site));
$('siteBack').onclick = () => send({ type: 'siteAction', action: 'back' });
$('siteForward').onclick = () => send({ type: 'siteAction', action: 'forward' });
$('siteReload').onclick = () => send({ type: 'siteAction', action: 'reload' });
$('siteDownloads').onclick = () => send({type:'siteAction',action:'downloads'});
$('siteExternal').onclick = () => send({ type: 'siteAction', action: 'external' });
$('sitePrint').onclick = () => send({ type: 'siteAction', action: 'savepdf' });
$('siteCopy').onclick = () => send({ type: 'siteAction', action: 'copylink' });
if ($('checkUpdate')) $('checkUpdate').onclick = () => send({ type: 'checkUpdate' });
$('portalUpdate').onclick = () => { send({ type: 'importTimetable', fromFolder: true }); toast('קורא את הקבצים מתיקיית מערכת שעות...'); };
function syncDownloadTarget() { send({ type: 'setDownloadTarget', course: $('dlCourse').value, folder: $('dlFolder').value }); $('dlFolder').disabled = !$('dlCourse').value; }
// The bar above a site always shows the course and the lecture that files are saved into.
function fillSaveFolders(course, selected) {
  const f = $('dlFolder'); f.innerHTML = '';
  if (!course) { f.add(new Option('תיקיית ההורדות', '')); f.disabled = true; return; }
  f.disabled = false;
  const lecs = (S.course && S.course.name === course ? S.sections : []).filter(s => s.num > 0);
  lecs.forEach(s => { f.add(new Option(`הרצאה ${s.num} › מצגות וחומר`, `הרצאות\\הרצאה ${s.num}`)); f.add(new Option(`הרצאה ${s.num} › שיעורי בית`, `הרצאות\\הרצאה ${s.num}\\תרגילים`)); });
  f.add(new Option('מבחנים', 'מבחנים')); f.add(new Option('מידע על הקורס', 'מידע על הקורס'));
  if (selected && ![...f.options].some(o => o.value === selected)) f.add(new Option(selected, selected));
  f.value = selected || (f.options[0] && f.options[0].value) || '';
}
function setSaveTarget(course, folder) {
  const c = $('dlCourse');
  if (course && ![...c.options].some(o => o.value === course)) c.add(new Option(course, course));
  c.value = course || '';
  fillSaveFolders(course, folder);
  syncDownloadTarget();
}
$('dlCourse').onchange = () => { fillSaveFolders($('dlCourse').value, ''); syncDownloadTarget(); };
$('dlFolder').onchange = syncDownloadTarget;
function fillDownloadCourses() {
  const cur = $('dlCourse').value;
  const names = (S.courses || []).filter(c => c.current).map(c => c.name);
  if (cur && !names.includes(cur)) names.push(cur);
  $('dlCourse').innerHTML = '<option value="">תיקיית "הורדות"</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('dlCourse').value = cur;
  $('dlFolder').disabled = !$('dlCourse').value;
}

// ---------- Settings ----------
// A picture or two colours behind a course, and the student's own photo.
function bgStyle(bg) { if (!bg) return ''; if (bg.startsWith('data:')) return `url(${bg}) center/cover`; const [a, b] = bg.split(','); return `linear-gradient(135deg, ${a}, ${b})`; }
function applyBg(el, bg) {
  if (!el) return;
  const css = bgStyle(bg);
  el.style.background = css; el.classList.toggle('has-bg', !!css);
}
const BG_PRESETS = [['#f59e0b', '#ec4899'], ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#6366f1'], ['#10b981', '#0ea5e9'], ['#ef4444', '#f59e0b'], ['#ec4899', '#8b5cf6'], ['#14b8a6', '#84cc16'], ['#475569', '#1e293b']];
$('changeBg').onclick = (e) => {
  e.stopPropagation();
  const old = document.querySelector('.bg-pop'); if (old) { old.remove(); return; }
  const pop = h('<div class="bg-pop"><b>רקע לקורס</b><div class="sw"></div><div class="row"><button class="soft small" data-img>תמונה מהמחשב</button><button class="ghost small" data-reset>ברירת מחדל</button></div></div>');
  BG_PRESETS.forEach(([a, b]) => { const s = h('<button class="swatch" title="בחר"></button>'); s.style.background = `linear-gradient(135deg, ${a}, ${b})`; s.onclick = () => { send({ type: 'setCourseBackground', course: S.course.name, mode: 'color', colors: a + ',' + b }); pop.remove(); }; pop.querySelector('.sw').append(s); });
  pop.querySelector('[data-img]').onclick = () => { send({ type: 'setCourseBackground', course: S.course.name, mode: 'image' }); pop.remove(); };
  pop.querySelector('[data-reset]').onclick = () => { send({ type: 'setCourseBackground', course: S.course.name, mode: 'reset' }); pop.remove(); };
  document.body.append(pop);
  const br = $('changeBg').getBoundingClientRect();
  Object.assign(pop.style, { position: 'fixed', insetInlineEnd: 'auto', insetBlockStart: 'auto', zIndex: 60 });
  // Always fully inside the window: below the button when there is room, otherwise above it.
  const ph = pop.offsetHeight, pw = pop.offsetWidth;
  pop.style.top = Math.max(8, Math.min(br.bottom + 8, innerHeight - ph - 8)) + 'px';
  pop.style.left = Math.max(8, Math.min(br.left, innerWidth - pw - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', function close(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close); } }), 0);
};
$('pickProfile').onclick = () => send({ type: 'pickProfileImage' });
$('clearProfile').onclick = () => send({ type: 'clearProfileImage' });
function shownName(st) { return ((st && st.displayName) || S.userName || (st && st.userName) || '').trim(); }
function renderProfile(st) {
  const img = st.profileImage || '';
  $('profilePreview').hidden = !img; if (img) $('profilePreview').src = img;
  const name = shownName(st);
  $('brandName').textContent = name || 'SumIT';
  $('brandSub').textContent = st.bio || (name ? 'SumIT' : 'כל הלימודים במקום אחד');
  $('navLogo').innerHTML = img ? `<img src="${img}" alt="" class="brand-photo">` : ART.mascot();
  if (document.activeElement !== $('profName')) $('profName').value = st.displayName || '';
  if (document.activeElement !== $('profBio')) $('profBio').value = st.bio || '';
}
$('helperPref').onchange = () => send({ type: 'setOption', name: 'helperPref', value: $('helperPref').value });
$('saveProfile').onclick = () => { send({ type: 'setProfile', name: $('profName').value, bio: $('profBio').value }); $('profileDlg').hidden = true; toast('נשמר'); };
// The pen on the picture opens the profile: name, short description and picture.
function openProfile(e) { if (e) { e.stopPropagation(); e.preventDefault(); } renderProfile(S.settings || {}); $('profileDlg').hidden = false; icons($('profileDlg')); setTimeout(() => $('profName').focus(), 50); }
$('editProfile').onclick = openProfile;
$('editProfile').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') openProfile(e); };
$('profileClose').onclick = () => { $('profileDlg').hidden = true; };
$('profileDlg').onclick = (e) => { if (e.target === $('profileDlg')) $('profileDlg').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('profileDlg').hidden) $('profileDlg').hidden = true; });

function renderSettings() {
  renderProfile(S.settings);
  renderProviders();
  $('helperPref').value = S.settings.helperPref || 'auto';
  const st = S.settings;
  $('studyRoot').textContent = st.studyRoot;
  $('notabilityDir').textContent = st.notabilityDir || 'לא נבחרה';
  $('versionText').textContent = 'SumIT ' + (st.version || '');
  $('wizStudy').textContent = st.studyRoot;
  // First run: the best place for the files is the OneDrive of HIT (up to 1TB for every student), so everything is also saved in the cloud.
  const od = $('wizOneDrive');
  if (od) {
    od.innerHTML = '';
    if (st.hitOneDrive && st.studyInHitOneDrive) od.append(h('<div class="check-row ok"><div class="ci" data-ic="check"></div><div class="grow"><b>OneDrive של HIT <span class="chip ok">מומלץ</span></b><small>מצאתי אותו, והחומר יישמר שם. יש לך שם עד 1TB, הכל מגובה בענן וזמין מכל מחשב.</small></div></div>'));
    else if (st.hitOneDrive) {
      const row = h('<div class="check-row"><div class="ci" data-ic="folder"></div><div class="grow"><b>OneDrive של HIT <span class="chip accent">מומלץ</span></b><small>עד 1TB של מקום בחינם, הכל מגובה בענן וזמין מכל מחשב. עדיף לשמור שם את כל החומר.</small></div><button class="primary" data-od>השתמש בו</button></div>');
      row.querySelector('[data-od]').onclick = () => send({ type: 'useHitOneDrive' });
      od.append(row);
    } else od.append(h('<div class="check-row"><div class="ci" data-ic="alert"></div><div class="grow"><b>לא מצאתי OneDrive של HIT במחשב</b><small>מומלץ להתחבר ל-OneDrive עם החשבון של HIT (יש בו עד 1TB, והחומר יהיה גם בענן) ולהפעיל את האפליקציה מחדש, כדי שאציע אותו. אם לא, בחר למטה כונן או תיקייה אחרת.</small></div></div>'));
    icons(od);
  }
  $('wizNot').textContent = st.notabilityDir || 'אם Notability מגבה את המחברות לתיקייה במחשב, בחר אותה כאן';
  $('wizNotRow').classList.toggle('ok', !!st.notabilityDir);
  $('optFallback').checked = st.autoFallback !== false; $('optPdfDark').checked = !!st.pdfDark;
  ['optSync','optRec','optUpdate'].forEach(id => { $(id).checked = false; $(id).closest('.setting').hidden = true; });
  $('versionText').textContent = `SumIT ${st.version || ''} · מתעדכנת לבד כשיוצאת גרסה חדשה`;
  applyTheme(st.theme || 'system');
  if ($('discordUrl') && document.activeElement !== $('discordUrl')) $('discordUrl').value = st.discordUrl || 'https://discord.gg/';
}
if ($('discordUrl')) $('discordUrl').onchange = () => send({ type: 'setOption', name: 'discordUrl', value: $('discordUrl').value });
if ($('openDiscordBtn')) $('openDiscordBtn').onclick = () => {
  const url = ($('discordUrl')?.value || S.settings?.discordUrl || 'https://discord.gg/').trim();
  send({ type: 'openLink', url });
};
if ($('navDiscord')) $('navDiscord').onclick = () => {
  const url = (S.settings?.discordUrl || $('discordUrl')?.value || 'https://discord.gg/').trim();
  send({ type: 'openLink', url });
};
$('changeStudy').onclick = $('wizStudyBtn').onclick = () => send({ type: 'chooseFolder', which: 'study' });
$('openStudy').onclick = () => send({ type: 'openFolder', which: 'study' });
$('changeNotability').onclick = $('wizNotBtn').onclick = () => send({ type: 'chooseFolder', which: 'notability' });
$('showWelcome').onclick = () => openWizard(0);
$('themeSelect').onchange = () => { applyTheme($('themeSelect').value); send({ type: 'setOption', name: 'theme', value: S.theme }); };
$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next); send({ type: 'setOption', name: 'theme', value: next });
};
[['optSync', 'autoSync'], ['optRec', 'autoRecordings'], ['optUpdate', 'autoUpdate'], ['optFallback', 'autoFallback'], ['optPdfDark', 'pdfDark']].forEach(([id, name]) =>
  $(id).onchange = () => send({ type: 'setOption', name, value: $(id).checked }));

// ---------- First-run setup ----------
let wizStep = 0, wizPoll = null;
// Order: welcome -> Moodle -> pick this semester's courses -> AI -> folders -> done (downloads start in the background).
const wizArt = ['welcome', 'campus', 'folders', 'ai', 'folders', 'done'];
const wizNext = ['בוא נתחיל', 'המשך', 'המשך', 'המשך', 'המשך', 'לאפליקציה'];
const LAST = wizNext.length - 1;
function renderWizardCourses() {
  const box = $('wizCourses'); if (!box) return;
  box.innerHTML = '';
  if (S.moodle !== 'ready') { box.append(h('<div class="check-row"><div class="ci" data-ic="alert"></div><div class="grow"><b>קודם צריך להתחבר ל-Moodle</b><small>חזור שלב אחד אחורה ולחץ "התחבר".</small></div></div>')); return; }
  if (!S.courses) { box.append(h('<div class="row" style="gap:10px"><span class="spinner"></span>מחפש את הקורסים שלך...</div>')); return; }
  const cur = S.courses.filter(c => c.current);
  if (!cur.length) { box.append(h('<div class="muted">לא מצאתי קורסים פעילים ב-Moodle. אפשר להמשיך, ולבחור קורסים אחר כך.</div>')); return; }
  S.wizPick = S.wizPick || new Set(cur.map(c => c.id));
  cur.forEach(c => {
    const row = h(`<label class="check-row" style="cursor:pointer"><input type="checkbox" style="width:18px;height:18px" ${S.wizPick.has(c.id) ? 'checked' : ''}><div class="grow"><b dir="auto"></b><small dir="auto"></small></div></label>`);
    row.querySelector('b').textContent = c.name; row.querySelector('small').textContent = c.category || '';
    row.querySelector('input').onchange = (e) => { e.target.checked ? S.wizPick.add(c.id) : S.wizPick.delete(c.id); };
    box.append(row);
  });
}
function openWizard(step) { $('wizard').hidden = false; goStep(step || 0); }
function closeWizard() {
  $('wizard').hidden = true; clearInterval(wizPoll); wizPoll = null;
  send({ type: 'finishOnboarding' });
}
function goStep(n) {
  wizStep = n;
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('active', +s.dataset.step === n));
  document.querySelectorAll('#wizDots i').forEach((d, i) => d.classList.toggle('on', i === n));
  $('wizArt').innerHTML = ART[wizArt[n]]();
  if (window.mountWizGauntlet) window.mountWizGauntlet($('wizArt'));   // the stones fly into the gauntlet as things get connected
  $('wizNext').textContent = wizNext[n];
  $('wizBack').hidden = n === 0 || n === LAST;
  $('wizSkip').hidden = n === LAST;
  clearInterval(wizPoll);
  if (n === 1 || n === 3) wizPoll = setInterval(() => send({ type: 'checkStatus' }), 5000);
  if (n === 2 && S.moodle === 'ready' && !S.courses) send({ type: 'loadCourses' });
  renderProviders(); renderWizardMoodle(); renderWizardCourses();
}
$('wizNext').onclick = () => {
  if (wizStep === 1 && S.moodle !== 'ready') { toast('קודם מתחברים ל-Moodle, ואז ממשיכים'); return; }
  if (wizStep === 3 && !(S.ai && S.ai.ready)) toast('אפשר לחבר את המנוע החכם גם אחר כך, מהסטטוס בצד', { ms: 3500 });
  if (wizStep >= LAST) {
    // Start downloading the chosen courses in the background.
    const picked = (S.courses || []).filter(c => S.wizPick && S.wizPick.has(c.id)).map(c => ({ id: c.id, name: c.name }));
    // Course files are selected by the student per lecture.
    closeWizard(); show('home'); return;
  }
  goStep(wizStep + 1);
};
$('wizBack').onclick = () => goStep(Math.max(0, wizStep - 1));
$('wizSkip').onclick = closeWizard;
$('wizMoodleBtn').onclick = connectMoodle;
function renderWizardMoodle() {
  const ok = S.moodle === 'ready';
  $('wizMoodle').classList.toggle('ok', ok);
  $('wizMoodleTitle').textContent = ok ? `מחובר${S.userName ? ' · ' + S.userName : ''}` : S.moodle === 'connecting' ? 'מתחבר...' : 'עוד לא מחובר';
  $('wizMoodleSub').textContent = ok ? 'ההתחברות ל-Moodle הושלמה, ואפשר להמשיך.' : 'לחץ על "התחבר". חלון ההתחברות של HIT ייפתח כאן באפליקציה.';
  $('wizMoodleBtn').hidden = ok;
}

// ---------- Messages from the app ----------
function onMessage(m) {
  rememberCourseEvent(m);
  if (window.stonesHook) window.stonesHook(m);
  switch (m.type) {
    case 'chatStream': {
      if (!S.course || S.course.name !== m.course || (m.scope || 'course') !== S.chatScope) break;
      if (thinking) { thinking.remove(); thinking = null; }
      let lastMsg = [...document.querySelectorAll('#msgs .msg.assistant')].pop();
      if (!lastMsg || !lastMsg.dataset.streaming) {
        lastMsg = addMsg('assistant', m.text);
        lastMsg.dataset.streaming = '1';
      } else {
        lastMsg.innerHTML = md(m.text);
        $('msgs').scrollTop = $('msgs').scrollHeight;
      }
      break;
    }
    case 'settings':
      S.settings = m; S.ready.settings = true; S.tasks = m.tasks || [];
      if (S.view === 'tasks') renderTasks($('tasksPage'), false); renderHome();
      if (m.userName) S.userName = m.userName;
      renderSettings(); renderStatus();
      if (!m.onboarded && $('wizard').hidden) openWizard(0);
      maybeHideSplash();
      break;
    case 'aiStatus': S.ai = m.status; S.ready.ai = true; renderStatus(); maybeHideSplash(); if (S.view === 'course') { $('chatSub').textContent = `${aiName()} · מכיר את כל החומר שהורדת`; } break;
    case 'moodle':
      S.moodle = m.state; renderStatus();
      if (m.state === 'error' && m.message) toast(m.message, { error: true });
      if (m.state === 'ready' && !S.courses) send({ type: 'loadCourses' });
      if (!$('wizard').hidden) renderWizardCourses();
      if (m.state === 'login' && S.view === 'courses' && !S.courses) { $('courses').innerHTML = ''; $('coursesState').innerHTML = ''; $('coursesState').append(h(`<div class="empty">${ART.campus().replace('<svg', '<svg class="art" style="width:220px;height:130px"')}<b>צריך להתחבר ל-Moodle</b>מתחברים פעם אחת עם המשתמש של HIT.<div class="row"><button class="primary" id="cm">התחבר</button></div></div>`)); $('cm').onclick = connectMoodle; }
      if (S.view === 'home') renderHome();
      break;
    case 'home': S.events = m.events || []; if (m.name) S.userName = m.name; renderHome(); renderWizardMoodle(); renderProfile(S.settings); break;
    case 'courses':
      S.courses = (m.data || []).filter(c => !/^ספרי[יה]ה?\s*$/.test((c.name || '').trim())); renderCourses(); fillDownloadCourses();
      if (S.view === 'home') renderHome();
      if (!$('wizard').hidden) renderWizardCourses();
      break;
    case 'course': {
      if (!S.course || S.course.id !== m.id) break;
      S.sourceSections = m.sections;
      S.sections = (m.local.lectures || []).map(s => Object.assign(s, { status: '', busy: false }, lectureState(s)));
      S.local = m.local; S.notability = m.notability;
      if (document.activeElement !== $('lecturer')) $('lecturer').value = m.lecturer || '';
      // The lecturer found in Moodle is offered in the setup questions, not announced with a pop-up.
      if (!m.lecturer && m.lecturerGuess && m.lecturerGuess.length && !$('lecturer').value) $('lecturer').value = m.lecturerGuess[0];
      renderCourseHeader(); renderLectures();
      // A course that hasn't been set up yet shows only the setup questions; afterwards the lessons.
      if (inSetup()) applySetupMode();
      else { applySetupMode(); if (!m.cached || S.tab === 'setup') setTab(S.tab === 'setup' || !S.tab ? 'lessons' : S.tab); }
      // Once a course is set up, new material on Moodle shows up as a question (the app sends newMaterial).
      // Moodle categories are available through the source browser.
      restoreCourseRuntime(true);
      break;
    }
    case 'operationStatus':
      if(S.course?.name===m.course){restoreCourseRuntime();if(S.tab==='info')renderInfo();if(S.tab==='exams')renderExams();}
      break;
    case 'learnStatus':
      if (!S.course || S.course.name !== m.course) break;
      courseStatus(m.text, m.busy, false);
      $('learnAll').disabled = m.busy;
      break;
    case 'setupRun':
      // Downloads finished: the course leaves setup and the study material is being built.
      if (!m.busy) {
        if (S.setupRunning) delete S.setupRunning[m.course];
        if (S.course && S.course.name === m.course) { if (S.local) S.local.setupDone = true; applySetupMode(); setTab('lessons'); }
      }
      break;
    case 'courseError':
      if (S.course && S.course.id === m.id && !S.sections.length) { renderLectures(); $('lectures').append(h(`<div class="empty">${ART.empty().replace('<svg', '<svg class="art"')}<b>לא הצלחתי לקרוא את הקורס</b><span dir="auto">${esc(m.message)}</span></div>`)); }
      break;
    case 'sectionStatus': {
      if (!S.course || S.course.name !== m.course) break;
      const s = section(m.num); if (!s) break;
      s.status = m.text; s.statusError = m.error; if (!s.aiBusy) s.busy = m.busy;
      refreshSection(m.num); break;
    }
    case 'sectionLocal': {
      if (!S.course || S.course.name !== m.course) break;
      const s = section(m.num); if (s) { s.local = m.local; refreshSection(m.num); }
      if (S.tab === 'setup' || S.tab === 'recs') setTab(S.tab);
      break;
    }
    case 'courseLocal':
      if (!S.course || S.course.name !== m.course) break;
      S.local = m.local; S.notability = m.notability;
      S.sections = (m.local.lectures || []).map(row => Object.assign({}, S.sections.find(s => s.num === row.num), row, lectureState(row)));
      restoreCourseRuntime();
      renderLectures(); renderCourseHeader();
      if (S.tab !== 'lessons') setTab(S.tab);
      if (S.courses) { const c = S.courses.find(x => x.name === m.course); if (c) c.local = m.local; }
      break;
    case 'newMaterial': {
      S.newMaterial = S.newMaterial || {};
      S.newMaterial[m.course] = m.items;
      if (S.courses) markNewOnCard(m.course, m.items.length);
      // Students choose which new source files belong to each lecture.
      break;
    }
    case 'courseStatus':
      if (m.pct != null) { S.progress = S.progress || {}; S.progress[m.course] = { pct: m.pct, text: m.text }; }
      if (m.setup && S.courses) markCourseCard(m.course, m.pct);
      if (!S.course || S.course.name !== m.course) break;
      if (m.setup && $('setupProgress')) { updateSetupProgress(m.course); break; }
      courseStatus(m.text, m.busy, m.error, m.pct);
      if (m.error && !m.busy && m.text) toast(m.text, { error: true, ms: 9000 });
      restoreCourseRuntime(); if (S.tab === 'info') renderInfo(); if (S.tab === 'exams') renderExams();
      // After the setup questions: everything is downloaded, so start preparing the study material.
      if (m.synced && S.learnAfterSync && S.learnAfterSync[m.course]) {
        delete S.learnAfterSync[m.course];
        if (S.setupRunning) delete S.setupRunning[m.course];
        if (S.local) S.local.setupDone = true;
        applySetupMode(); setTab('lessons');
        send({ type: 'learnCourse', course: S.course.name, sections: plainSections() });
      }
      if (m.synced && S.pendingChat) {
        const p = S.pendingChat; S.pendingChat = null;
        if (p.scope !== S.chatScope) setChatScope(p.scope);
        S.chatBusy = true; $('chatSend').disabled = true; setThinking('החומר ירד. קורא אותו...');
        send({ type: 'chat', course: S.course.name, scope: p.scope, text: p.text });
      }
      break;
    case 'aiRun': {
      const parts = m.key.split('|');
      if (!S.course || S.course.name !== parts[1]) break;
      if (parts[0] === 'sum') {
        const s = section(+parts[2]); if (!s) break;
        s.aiBusy = m.busy; if (!m.busy) { s.busy = false; s.pct = null; }
        refreshSection(s.num);
        const log = document.querySelector(`.lecture[data-num="${s.num}"] .ai-log`);
        // Plain steps while it works; at the end just "ready" - the AI's own notes aren't for the student.
        if (log && m.busy) { log.innerHTML = '<div class="phase now">מתחיל...</div>'; log.classList.add('show'); }
        if (log && !m.busy) { log.querySelectorAll('.phase').forEach(p => p.classList.remove('now')); log.append(h(`<div class="phase ${m.error ? 'bad' : 'done'}">${m.error ? 'לא הצליח. אפשר לנסות שוב.' : 'מוכן ✓'}</div>`)); }
      } else if (!m.busy && !m.error) toast(parts[0] === 'info' ? 'המידע על הקורס מוכן' : 'ההכנה למבחן מוכנה');
      restoreCourseRuntime(); if (S.tab === 'info') renderInfo(); if (S.tab === 'exams') renderExams();
      break;
    }
    case 'aiLog': {
      const parts = m.key.split('|');
      if (!S.course || S.course.name !== parts[1] || parts[0] !== 'sum') break;
      const log = document.querySelector(`.lecture[data-num="${parts[2]}"] .ai-log`); if (!log) break;
      log.classList.add('show');
      log.querySelectorAll('.phase').forEach(p => { p.classList.remove('now'); if (!p.classList.contains('bad')) p.classList.add('done'); });
      const d = document.createElement('div'); d.className = 'phase now'; d.textContent = m.text; log.append(d);
      break;
    }
    case 'chat':
      if (!S.course || S.course.name !== m.course) break;
      if ((m.scope || 'course') !== S.chatScope) { (S.chatLogs[m.scope] = S.chatLogs[m.scope] || []).push({ role: m.role, text: m.text }); break; }
      if (thinking) { thinking.remove(); thinking = null; }
      if (m.role === 'limit') { addMsg('error', m.text); break; }
      if (m.role === 'assistant') {
        const lastMsg = [...document.querySelectorAll('#msgs .msg.assistant')].pop();
        if (lastMsg && lastMsg.dataset.streaming) {
          lastMsg.innerHTML = md(m.text);
          delete lastMsg.dataset.streaming;
          (S.chatLogs[S.chatScope] = S.chatLogs[S.chatScope] || []).push({ role: m.role, text: m.text });
          break;
        }
      }
      addMsg(m.role, m.text);
      if (S.chatBusy && m.role === 'assistant') setThinking('ממשיך...');
      break;
    case 'chatVia': {
      if (!S.course || S.course.name !== m.course || (m.scope || 'course') !== S.chatScope) break;
      const last = [...document.querySelectorAll('#msgs .msg.assistant')].pop();
      if (last) last.append(h('<div class="msg-via">נענה על ידי ' + esc(m.who) + '</div>'));
      break;
    }
    case 'chatTool': if (S.course && S.course.name === m.course && (m.scope || 'course') === S.chatScope) setThinking(m.text); break;
    case 'chatDone': if(!S.course || S.course.name!==m.course || S.chatScope!==(m.scope||'course'))break; if (thinking) { thinking.remove(); thinking = null; } S.chatBusy = false; $('chatSend').disabled = false; addCheckButton(); break;
    case 'summaryReady':
      // The summary is not opened in a browser: a button opens its interactive version inside the app (the PDF is already in the lecture's folder).
      toast(`הסיכום של הרצאה ${m.num} מוכן`, { action: 'פתח את הסיכום', ms: 20000, onAction: () => openViewer(m.page, `הרצאה ${m.num} · סיכום`, m.pdf, m.num) });
      break;
    case 'authCode': S.authCode = m.state === 'wait' ? { kind: m.kind, url: m.url, phase:m.phase } : null; renderProviders(); break;
    case 'loginUrl':
      // The browser normally opens by itself; if it didn't, the address is here.
      toast(`אם הדפדפן לא נפתח, ההתחברות ל-${m.kind === 'gemini' ? 'Google' : m.kind === 'claude' ? 'Claude' : 'ChatGPT'} כאן:`, { action: 'פתח את דף ההתחברות', ms: 20000, onAction: () => send({ type: 'openLink', url: m.url }) });
      break;
    case 'needSync':
      // The assistant had nothing to read yet: download the course, then ask the same question again.
      if (!S.course || S.course.name !== m.course) break;
      S.pendingChat = { scope: m.scope, text: m.text };
      syncCourse(true);
      break;
    case 'aiLimit': showLimit(m); break;
    case 'geminiCode': showGeminiCode(); break;
    case 'job': renderJob(m); break;
    case 'log': jobLog(m.id, m.line); break;
    case 'clipboard': {
      // A copied Zoom link goes to the lesson that's open, or the latest lesson of the open course.
      if (!S.course || !S.sections.length) { toast('העתקת קישור להקלטת Zoom. פתח את הקורס ולחץ "הוסף הקלטה" בשיעור המתאים.'); break; }
      const open = [...S.open].filter(n => n > 0).sort((a, b) => b - a)[0];
      const latest = S.sections.filter(s => s.num > 0 && s.items.length).map(s => s.num).sort((a, b) => b - a)[0];
      const num = open || latest;
      if (num) toast(`העתקת קישור להקלטת Zoom`, { action: `הוסף לשיעור ${num}`, ms: 9000, onAction: () => send({ type: 'addRecording', course: S.course.name, num, url: m.url }) });
      break;
    }
    case 'summaryChatProvider': $('summaryChatStatus').textContent=m.text; break;
    case 'summarySelectionReady': case 'summaryChatResult': summaryChatEvent(m); break;
    case 'summaryShareProgress': case 'summaryShareResult': summaryShareStatus(m); break;
    case 'toast': toast(m.text, { error: m.error }); break;
    case 'updateCheck': { const t = document.getElementById('updateCheckText'); if (t) t.textContent = ' · ' + m.text; break; }
    case 'update': S.update = m; renderBanners(); break;
    case 'updateProgress': S.update = Object.assign(S.update || {}, { progress: m.text, error: m.error }); renderBanners(); break;
    case 'updateReady': S.updateReady = m.version; renderBanners(); toast(`העדכון לגרסה ${m.version} מוכן. הוא ייכנס בפעם הבאה שהאפליקציה נפתחת, או עכשיו:`, { action: 'הפעל מחדש', onAction: () => send({ type: 'restartForUpdate' }), ms: 15000 }); break;
    case 'notabilitySubjects': if (S.course) send({ type: 'openCourse', id: S.course.id, course: S.course.name }); break;
    case 'helperKeyResult': {
      toast(m.ok ? (m.provider === 'gemini' ? 'Gemini' : 'ChatGPT') + ' חובר, והוא יעזור בצ\'אט ובקריאת דפים' : 'לא התחבר: ' + m.message, { error: !m.ok, ms: 6000 });
      if (!m.ok) {
        document.querySelectorAll(`.provider[data-kind="${m.provider}"] [data-save]`).forEach(b => { b.disabled = false; b.textContent = 'חבר'; });
      } else {
        renderProviders(true);
      }
      break;
    }
    case 'sectionProgress': {
      if (!S.course || S.course.name !== m.course) break;
      const s = section(m.num); if (!s) break;
      s.pct = m.pct >= 100 ? null : m.pct; s.eta = m.pct >= 100 ? null : m.eta; s.pctText = m.pct >= 100 ? '' : m.text;
      const el = document.querySelector(`.lecture[data-num="${m.num}"]`); if (el) paintStatus(el, s);
      break;
    }
    case 'zoomRecording': {
      // The student opened a Zoom recording page in the app: offer to download it into the lecture they are working on.
      S.zoomOffered = S.zoomOffered || new Set(); if (S.zoomOffered.has(m.url)) break; S.zoomOffered.add(m.url);
      const course = $('dlCourse').value, lec = /הרצאה (\d+)/.exec($('dlFolder').value || '');
      if (course && lec) toast(`זו הקלטת Zoom. להוריד אותה להרצאה ${lec[1]}?`, { action: `הורד להרצאה ${lec[1]}`, ms: 25000, onAction: () => { send({ type: 'addLectureRecording', course, num: +lec[1], url: m.url, name: 'הרצאה מספר ' + lec[1] }); toast('ההקלטה יורדת ברקע לתיקייה של ההרצאה'); } });
      else toast('זו הקלטת Zoom. אפשר ללחוץ "העתק קישור" למעלה, ובהרצאה ללחוץ "הוסף הקלטה" ולהדביק.', { ms: 9000 });
      break;
    }
    case 'academicCalendar': S.academic = m.data; if (S.view === 'course') renderLectures(); break;
    case 'siteNav': { const onPortal = /webrashim\.hit\.ac\.il/i.test(m.url || ''); if (document.getElementById('portalHint').hidden === onPortal) { $('portalHint').hidden = !onPortal; requestAnimationFrame(() => placeSite(true)); } } $('siteUrl').textContent = m.url || ''; $('siteBack').disabled = !m.canBack; $('siteForward').disabled = !m.canForward; break;
    case 'timetable': S.timetable = m.data; renderTimetable(); break;
    case 'prepStatus':
      S.prep = m.busy ? m : null; renderBanners();
      if (!m.busy && m.total) toast(`הקורסים שבחרת מוכנים במחשב (${m.total})`);
      break;
    case 'timetableStatus':
      $('ttStatus').innerHTML = m.busy ? '<span class="spinner"></span> קורא את המערכת...' : '';
      if (!m.busy && m.text) toast(m.text, { error: m.error });
      break;
    case 'openSite':
      setSaveTarget(S.course ? S.course.name : '', S.course ? 'מידע על הקורס' : '');
      openSite(m.site);
      break;
    case 'siteDownload': {
      const strip = $('dlStrip');
      if (m.state === 'started' || m.state === 'progress') {
        strip.hidden = false;
        $('dlText').textContent = `שומר: ${m.name}${m.where ? ' ← ' + m.where : ''}`;
        const pct = m.state === 'progress' ? m.pct : null;
        $('dlPct').textContent = pct == null ? '' : pct + '%';
        $('dlBar').style.width = pct == null ? '100%' : pct + '%';
        strip.classList.toggle('indeterminate', pct == null);
      } else if (m.state === 'done') {
        strip.hidden = true;
        toast(`נשמר ב${m.where ? ': ' + m.where : ' תיקיית ההורדות'}\n${m.name}`, { action: S.course && $('dlCourse').value ? 'חזרה לקורס' : 'פתח', ms: 9000, onAction: () => { if (S.course && $('dlCourse').value) { S.viewer = null; show('course'); } else send({ type: 'openPath', path: m.dir }); } });
      } else if (m.state === 'failed') { strip.hidden = true; toast(`השמירה של ${m.name || 'הקובץ'} נכשלה`, { error: true }); }
      break;
    }
  }
}

// ---------- Start ----------
const launchStarted = performance.now();
let splashFinishTimer;
let splashTips = ['מכין את סביבת הלימוד שלך...', 'מתחבר ל-Moodle...', 'בודק את המנוע החכם...', 'כמעט מוכן...'], tipI = 0;
const tipTimer = setInterval(() => { const el = $('splashText'); if (el) el.textContent = splashTips[++tipI % splashTips.length]; }, 1400);
function maybeHideSplash(force) {
  if (!force && !(S.ready.settings && S.ready.ai)) return;
  const remaining = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2000 - (performance.now() - launchStarted);
  if (remaining > 0) { clearTimeout(splashFinishTimer); splashFinishTimer = setTimeout(() => maybeHideSplash(force), remaining); return; }
  clearInterval(tipTimer);
  if ($('splash')) $('splash').classList.add('hide');
}
setTimeout(() => maybeHideSplash(true), 7000);

function start() {
  host = DEMO ? window.DemoHost : (window.sumitBridge || (window.chrome && window.chrome.webview));
  if (!host) return;
  host.addEventListener('message', e => onMessage(e.data));
  icons();
  $('splashLogo').innerHTML = ART.mascot(); $('navLogo').innerHTML = ART.mascot();

  renderHome(); renderTimetable(); refreshJobs(); renderStatus();
  send({ type: 'ready' });
}
if (DEMO) {
  const s = document.createElement('script'); s.src = 'demo.js';
  s.onload = () => {
    start();
    // ?view=... opens a given screen, for screenshots.
    const q = new URLSearchParams(location.search), v = q.get('view'), tab = q.get('tab');
    setTimeout(() => {
      if (v === 'course') { openCourse(S.courses[0]); setTimeout(() => { if (tab) setTab(tab); else { S.open.add(1); renderLectures(); } if (q.has('chat')) { $('chatText').value = 'מה למדנו בשיעור 4?'; sendChat(); } }, 1200); }
      else if (v) show(v);
    }, 1700);
  };
  document.body.append(s);
}
else start();
function lectureSource(num, siteName, kind) {
  const base = `הרצאות\\הרצאה ${num}`;
  setSaveTarget(S.course.name, kind === 'homework' ? base + '\\תרגילים' : base);
  openSite(siteName, siteName === 'moodle' ? `https://md.hit.ac.il/course/view.php?id=${S.course.id}` : undefined);
  toast(kind === 'homework' ? `קבצים שתשמור כאן ייכנסו לשיעורי הבית של הרצאה ${num}. חשוב לשמור גם את הפתרונות` : `קבצים שתשמור כאן ייכנסו להרצאה ${num}`, { ms: 5000 });
}
function lectureSourceOld(num, siteName) {
  $('dlCourse').value = S.course.name;
  const folder = `הרצאות\\הרצאה ${num}`;
  if (![...$('dlFolder').options].some(o => o.value === folder)) $('dlFolder').add(new Option(`הרצאה ${num}`, folder));
  $('dlFolder').value = folder; syncDownloadTarget();
  openSite(siteName, siteName === 'moodle' ? `https://md.hit.ac.il/course/view.php?id=${S.course.id}` : undefined);
}
function lectureEditor(existing) {
  const form = h(`<form class="card pad-lg lecture-editor"><h3>${existing ? 'פרטי הרצאה' : 'צור הרצאה'}</h3><p class="muted">בחר חומר להרצאה אחת. לסיכום יצורף הידע הרלוונטי מההרצאות הקודמות. תאריך הגשה מזינים רק לפי הנחיית המרצה.</p><div class="row wrap"><label>מספר <input name="num" type="number" min="1" max="200" required></label><label>כותרת <input name="title" placeholder="נושא ההרצאה"></label><label>תאריך הרצאה <input name="date" type="date"></label><label>מועד הגשה (אם ידוע) <input name="due" type="date"></label><button class="primary">${existing ? 'שמור' : 'צור תיקיית הרצאה'}</button></div></form>`);
  form.elements.num.value = existing ? existing.num : Math.max(0,...S.sections.map(s=>s.num))+1;
  form.elements.num.readOnly = !!existing;
  ['title','date','due'].forEach(k => form.elements[k].value = existing ? existing[k] || '' : '');
  if (!existing) { const suggest = () => form.elements.date.value = suggestedLectureDate(+form.elements.num.value, S.local && S.local.lectureCalendar, timetableLectureDays()); suggest(); form.elements.num.onchange = suggest; }
  form.onsubmit = e => { e.preventDefault(); const num = +form.elements.num.value; if (!existing && S.sections.some(s => s.num === num)) return toast('הרצאה זו כבר קיימת; השתמש בעריכת הפרטים שלה'); send({type:'saveLecture',course:S.course.name,num,title:form.elements.title.value,date:form.elements.date.value,due:form.elements.due.value}); S.open.add(num); if (existing) form.remove(); };
  return form;
}

// The days of the week this course's lectures are on, from the student's timetable (null when it isn't there).
function timetableLectureDays() {
  const idx = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
  const name = (S.course && S.course.name) || '';
  const rows = ((S.timetable && S.timetable.classes) || []).filter(c => c.course && (c.course === name || (c.course.length > 3 && (name.includes(c.course) || c.course.includes(name)))) && !/תרגול|מעבדה/.test(c.kind || ''));
  const days = [...new Set(rows.map(c => idx[(c.day || '').replace(/^יום\s*/, '').trim()]).filter(d => d !== undefined))];
  return days.length ? days : null;
}

// Before the first lecture: past exams (with solutions) teach the app which questions this lecturer asks and how he answers.
function downloadMoodle(what) {
  send({ type: 'downloadMoodle', course: S.course.name, id: S.course.id, what });
  toast(what === 'exams' ? 'מוריד את כל המבחנים והפתרונות מה-Moodle...' : 'מסנכרן את הסילבוס...', { ms: 5000 });
}
function examsIntroNeeded() { return !!(S.local && !S.local.exams && !S.local.examsSkipped && !S.sections.length); }
function examsIntroCard() {
  const c = h(`<div class="card pad-lg exams-intro"><div class="row wrap" style="gap:14px;align-items:flex-start"><span class="qa-av big">${ART.mascot('wave')}</span>
    <div class="grow"><h2>לפני שמתחילים: מבחנים משנים קודמות</h2>
    <p class="muted" style="margin:6px 0 12px">הביאו לי מבחנים קודמים של הקורס, עדיף עם הפתרונות. כך אראה אילו שאלות המרצה שואל ואיך הוא עונה עליהן, וזה ישפר כל סיכום הרצאה שאכין אחר כך.</p>
    <div class="row wrap" data-b></div></div></div></div>`);
  const row = c.querySelector('[data-b]');
  const add = (ic, t, cls, fn) => { const b = h(`<button class="${cls}"><span data-ic="${ic}"></span>${t}</button>`); b.onclick = fn; row.append(b); };
  add('download', 'הורד את כל המבחנים מה-Moodle', 'primary', () => downloadMoodle('exams'));
  add('exam', 'מבחנים מ-CS24', 'soft', () => { setSaveTarget(S.course.name, 'מבחנים'); openSite('cs24'); });
  add('plus', 'מהמחשב', 'ghost', () => send({ type: 'addFiles', course: S.course.name, folder: 'מבחנים' }));
  add('x', 'אין לי עכשיו - דלג', 'ghost', () => send({ type: 'skipExams', course: S.course.name }));
  return c;
}

function newLectureBar() {
  const next = Math.max(0, ...S.sections.map(s => s.num)) + 1;
  const bar = h(`<div class="card pad-lg new-lecture-bar"><div class="row wrap" style="gap:14px">
    <div class="grow"><b>אחרי כל הרצאה: צור אותה והכנס את החומר שלה</b>
    <div class="muted" style="font-size:12.5px;margin-top:3px">1. יוצרים את ההרצאה · 2. מכניסים מצגות, שיעורי בית והקלטה · 3. לוחצים "צור סיכום PDF" ומקבלים סיכום עם שיעורי הבית</div></div>
    <button class="primary big" data-new><span data-ic="plus"></span>הרצאה ${next}</button>
    <button class="link" data-more>עם כותרת ותאריכים</button></div></div>`);
  bar.querySelector('[data-new]').onclick = () => {
    const date = suggestedLectureDate(next, S.local && S.local.lectureCalendar, timetableLectureDays());
    send({ type: 'saveLecture', course: S.course.name, num: next, title: '', date: date || '', due: '' });
    S.open.add(next);
  };
  bar.querySelector('[data-more]').onclick = () => { if (!bar.querySelector('form')) bar.append(lectureEditor()); };
  return bar;
}

function suggestedLectureDate(num, calendar, days) {
  if (!calendar || !/^\d{4}-\d{2}-\d{2}$/.test(calendar.first || '') || !Number.isInteger(num) || num < 1 || num > 200) return '';
  const date = new Date(calendar.first + 'T12:00:00'); if (!Number.isFinite(+date)) return '';
  const holidays = new Set(calendar.holidays || []);
  const iso0 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (days && days.length) {
    // The course meets on these weekdays: count every meeting from the first lecture, skipping the days off.
    let n = 0;
    for (let i = 0; i < 600; i++, date.setDate(date.getDate() + 1)) if (days.includes(date.getDay()) && !holidays.has(iso0(date)) && ++n === num) return iso0(date);
    return '';
  }
  let count = 0;
  for (let i=0;i<1000;i++,date.setDate(date.getDate()+7)) {
    const iso = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    if (!holidays.has(iso) && ++count === num) return iso;
  }
  return '';
}
function lectureCalendarEditor() {
  const calendar = (S.local && S.local.lectureCalendar) || {};
  const box = h(`<details class="card pad-lg" style="margin-bottom:14px"><summary>תאריכי ההרצאות וחופשות (בשביל להציע תאריך לכל הרצאה)</summary><form>
    <p class="muted">בחר את תאריך ההרצאה הראשונה. האפליקציה תציע תאריך לכל הרצאה לפי הימים של הקורס במערכת השעות שלך (אחת בשבוע, או כמה), ותדלג על החופשות. ההצעה אפשר לתקן בכל הרצאה, והיא לא מועד הגשה.</p>
    <p class="muted" data-tt></p>
    <div class="row wrap" style="margin:6px 0"><button type="button" class="soft small" data-readcal>קרא תחילת סמסטר וחגים מאתר HIT</button><span class="muted" data-ac></span></div>
    <label>ההרצאה הראשונה <input name="first" type="date"></label>
    <input name="holidays" type="hidden">
    <div class="holiday-box"><b>חופשות וימי ביטול</b>
      <div class="row wrap" style="margin-top:6px"><input type="date" data-hf><span class="muted">עד</span><input type="date" data-ht><button type="button" class="soft small" data-hadd>הוסף</button></div>
      <div class="chips" data-hlist style="margin-top:8px"></div></div>
    <button class="soft">שמור</button></form></details>`);
  const form = box.querySelector('form');
  // Dates read from HIT's calendar page fill in what the student didn't enter yet.
  const ac = S.academic && S.academic.semesterStart ? S.academic : null;
  const expand = (list) => { const out = []; (list || []).forEach(x => { const d = new Date(x.from + 'T12:00:00'), e = new Date((x.to || x.from) + 'T12:00:00'); for (let n = 0; d <= e && n < 60; n++, d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }); return out; };
  let firstDate = calendar.first || '';
  if (!firstDate && ac) {
    const days = timetableLectureDays(); const d = new Date(ac.semesterStart + 'T12:00:00');
    for (let n = 0; n < 14 && days && !days.includes(d.getDay()); n++) d.setDate(d.getDate() + 1);
    firstDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  form.elements.first.value = firstDate;
  let holidays = ((calendar.holidays && calendar.holidays.length) ? calendar.holidays : (ac ? expand(ac.holidays) : [])).slice().sort();
  form.querySelector('[data-ac]').textContent = ac ? `מצאתי: הסמסטר מתחיל ב-${ac.semesterStart.split('-').reverse().join('/')}, ו-${(ac.holidays || []).length} חופשות/חגים. לחץ "שמור" כדי להשתמש בהם.` : '';
  form.querySelector('[data-readcal]').onclick = () => { toast('נפתח לוח השנה של HIT. אחרי שהדף נטען, לחץ למעלה "קרא תאריכי סמסטר וחגים מהדף"', { ms: 7000 }); openSite('calendar'); };
  const fmt = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
  const draw = () => {
    form.elements.holidays.value = holidays.join(', ');
    const list = form.querySelector('[data-hlist]'); list.innerHTML = '';
    // Consecutive days are shown as one range.
    const ranges = [];
    holidays.forEach(d => { const last = ranges[ranges.length - 1]; const next = last && new Date(last.to + 'T12:00:00'); if (next) next.setDate(next.getDate() + 1); if (last && iso(next) === d) last.to = d; else ranges.push({ from: d, to: d }); });
    ranges.forEach(r => {
      const c = h(`<span class="chip"><bdi dir="ltr">${r.from === r.to ? fmt(r.from) : fmt(r.from) + ' – ' + fmt(r.to)}</bdi> <button type="button" class="link" title="הסר">✕</button></span>`);
      c.querySelector('button').onclick = () => { holidays = holidays.filter(d => d < r.from || d > r.to); draw(); };
      list.append(c);
    });
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  form.querySelector('[data-hadd]').onclick = () => {
    const from = form.querySelector('[data-hf]').value, to = form.querySelector('[data-ht]').value || from;
    if (!from) return form.querySelector('[data-hf]').focus();
    const d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
    for (let n = 0; d <= end && n < 60; n++, d.setDate(d.getDate() + 1)) if (!holidays.includes(iso(d))) holidays.push(iso(d));
    holidays.sort(); form.querySelector('[data-hf]').value = ''; form.querySelector('[data-ht]').value = ''; draw();
  };
  draw();
  const days = timetableLectureDays();
  const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  form.querySelector('[data-tt]').textContent = days ? 'לפי המערכת שלך, ההרצאות של הקורס ביום ' + days.map(d => names[d]).join(' וביום ') + '.' : 'לא מצאתי את הקורס במערכת השעות. אפשר להוסיף אותה בדף הבית, ואז התאריכים יוצעו לבד.';
  form.onsubmit = e => { e.preventDefault(); send({ type: 'saveLectureCalendar', course: S.course.name, first: form.elements.first.value, holidays: form.elements.holidays.value }); toast('נשמר'); };
  return box;
}


// ---------- My tasks ----------
// The student's own to-do list (not from Moodle): a title, an optional course and date. Kept in the app's settings.
S.tasks = S.tasks || [];
function saveTasks() { send({ type: 'saveTasks', tasks: S.tasks }); renderHome(); if (S.view === 'tasks') renderTasks($('tasksPage')); }
function renderTasks(box) {
  if (!box) return;
  const keep = box.querySelector('[data-t-title]'); const draft = keep ? keep.value : '';
  const focused = keep && document.activeElement === keep;
  box.innerHTML = '';
  const open = S.tasks.filter(t => !t.done);
  const done = S.tasks.filter(t => t.done);
  const nav = $('taskCount'); if (nav) { nav.textContent = open.length; nav.hidden = !open.length; }
  const courses = (S.courses || []).filter(c => c.current).map(c => c.name);
  const total = S.tasks.length, pct = total ? Math.round(done.length / total * 100) : 0;
  box.append(h(`<div class="task-summary"><div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
    <div><b>${open.length ? open.length + (open.length === 1 ? ' מטלה פתוחה' : ' מטלות פתוחות') : 'אין מטלות פתוחות'}</b><small class="muted">${total ? done.length + ' מתוך ' + total + ' הושלמו' : 'אפשר להוסיף הגשות, הכנות למבחן וכל מה שצריך לזכור'}</small></div></div>`));
  const form = h(`<form class="task-add"><div class="task-add-main"><span class="ic assign" data-ic="plus"></span><input data-t-title placeholder="מה צריך לעשות? למשל: להגיש תרגיל 3" maxlength="200" autocomplete="off"></div>
    <div class="task-add-opts"><label>קורס<select data-t-course><option value="">כללי</option>${courses.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
    <label>עד תאריך<input type="date" data-t-due class="ltr"></label><button class="primary" type="submit"><span data-ic="plus"></span>הוסף מטלה</button></div></form>`);
  form.querySelector('[data-t-title]').value = draft;
  form.onsubmit = (e) => {
    e.preventDefault();
    const title = form.querySelector('[data-t-title]').value.trim(); if (!title) return form.querySelector('[data-t-title]').focus();
    S.tasks.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), title, course: form.querySelector('[data-t-course]').value, due: form.querySelector('[data-t-due]').value, done: false });
    saveTasks();
  };
  box.append(form);
  const dayDiff = (t) => t.due ? Math.round((new Date(t.due + 'T12:00:00') - new Date(new Date().toDateString())) / 86400000) : null;
  const row = (t) => {
    const days = dayDiff(t);
    const when = days == null ? '' : days < 0 ? 'עבר המועד' : days === 0 ? 'היום' : days === 1 ? 'מחר' : 'בעוד ' + days + ' ימים';
    const el = h(`<div class="task${t.done ? ' done' : ''}"><label class="task-check"><input type="checkbox"${t.done ? ' checked' : ''}><span class="box"></span></label><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div>${when ? `<span class="chip${days < 0 && !t.done ? ' bad' : days <= 2 && !t.done ? ' warn' : ''}">${when}</span>` : ''}<button class="small ghost" title="מחק" data-del><span data-ic="x"></span></button></div>`);
    el.querySelector('b').textContent = t.title;
    el.querySelector('small').textContent = [t.course, t.due ? t.due.split('-').reverse().join('/') : ''].filter(Boolean).join(' · ');
    el.querySelector('input').onchange = (e) => { t.done = e.target.checked; saveTasks(); };
    el.querySelector('[data-del]').onclick = () => { S.tasks = S.tasks.filter(x => x !== t); saveTasks(); };
    return el;
  };
  const group = (title, list, cls) => { if (!list.length) return; const g = h(`<div class="task-group ${cls || ''}"><h3>${title}<span class="chip">${list.length}</span></h3></div>`); list.forEach(t => g.append(row(t))); box.append(g); };
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
  group('עבר המועד', open.filter(t => dayDiff(t) != null && dayDiff(t) < 0).sort(byDue), 'late');
  group('השבוע', open.filter(t => dayDiff(t) != null && dayDiff(t) >= 0 && dayDiff(t) <= 7).sort(byDue));
  group('בהמשך', open.filter(t => dayDiff(t) != null && dayDiff(t) > 7).sort(byDue));
  group('בלי תאריך', open.filter(t => dayDiff(t) == null));
  group('הושלמו', done, 'finished');
  icons(box);
  if (focused) form.querySelector('[data-t-title]').focus();
}
