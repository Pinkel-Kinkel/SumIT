// Flashcards for the summary on screen, in the left column like the chat (so the site view stays between them and the
// sidebar). The host makes them in three Gemini passes and keeps them next to the summary; a card flips on click.
const cardSets = new Map();   // summary path -> { cards, i, back }
let cardsJob = null;          // { requestId, path, step, steps, text }

function cardSet() { return S.viewer ? cardSets.get(S.viewer.path) : null; }

function openFlashcards(regenerate) {
  if (!S.viewer || !S.course) return;
  $('summaryChat').hidden = true;
  $('flashcards').hidden = false;
  const path = S.viewer.path;
  if (cardsJob && cardsJob.path !== path) $('flashcards').dataset.error = 'מכין עכשיו כרטיסים לסיכום אחר. נסה שוב בעוד רגע.';
  else if ((!cardSets.has(path) || regenerate) && !cardsJob) {
    const requestId = 'cards-' + Date.now();
    cardsJob = { requestId, path, step: 0, steps: 3, text: 'מתחיל…', error: '' };
    send({ type: 'flashcards', requestId, course: S.course.name, path, title: S.viewer.title || '', regenerate: !!regenerate });
  }
  renderFlashcards();
  requestAnimationFrame(() => placeSite(false));
}

function renderFlashcards() {
  if (!S.viewer || $('flashcards').hidden) return;
  const set = cardSet(), busy = cardsJob?.path === S.viewer.path, err = $('flashcards').dataset.error || '';
  $('cardsProgress').hidden = !busy;
  if (busy) {
    $('cardsStep').textContent = `שלב ${Math.max(1, cardsJob.step)} מתוך ${cardsJob.steps}: ${cardsJob.text}`;
    $('cardsBar').style.width = Math.round((Math.max(1, cardsJob.step) - 0.5) / cardsJob.steps * 100) + '%';
  }
  $('cardsError').hidden = busy || !err;
  $('cardsError').textContent = err;
  $('cardsRedo').disabled = !!cardsJob;
  const show = !busy && set && set.cards.length;
  $('cardsCard').hidden = $('cardsNav').hidden = !show;
  if (!show) return;
  const c = set.cards[set.i];
  $('cardsCard').classList.toggle('back', set.back);
  $('cardsTag').textContent = c.tag || '';
  $('cardsSide').textContent = set.back ? 'תשובה' : 'שאלה';
  $('cardsText').innerHTML = md(set.back ? c.back : c.front);
  $('cardsHint').textContent = set.back ? 'לחץ כדי לחזור לשאלה' : 'נסה לענות בראש, ואז לחץ כדי להפוך';
  $('cardsCount').textContent = `כרטיס ${set.i + 1} מתוך ${set.cards.length}`;
  $('cardsPrev').disabled = set.i === 0;
  $('cardsNext').disabled = set.i === set.cards.length - 1;
}

function moveCard(d) {
  const set = cardSet(); if (!set) return;
  set.i = Math.min(set.cards.length - 1, Math.max(0, set.i + d)); set.back = false;
  renderFlashcards();
}

function flashcardsEvent(m) {
  if (!cardsJob || m.requestId !== cardsJob.requestId) return;
  if (m.type === 'flashcardsProgress') { Object.assign(cardsJob, { step: m.step, steps: m.steps, text: m.text }); renderFlashcards(); return; }
  const path = cardsJob.path; cardsJob = null;
  $('flashcards').dataset.error = m.error ? m.text : '';
  if (!m.error) cardSets.set(path, { cards: m.cards, i: 0, back: false });
  else if (S.viewer?.path !== path || $('flashcards').hidden) toast(m.text, { error: true });
  renderFlashcards();
}

$('viewerCards').onclick = () => { $('flashcards').dataset.error = ''; $('flashcards').hidden ? openFlashcards(false) : ($('flashcards').hidden = true, requestAnimationFrame(() => placeSite(false))); };
$('cardsClose').onclick = () => { $('flashcards').hidden = true; requestAnimationFrame(() => placeSite(false)); };
$('cardsRedo').onclick = () => { $('flashcards').dataset.error = ''; openFlashcards(true); };
$('cardsCard').onclick = () => { const set = cardSet(); if (set) { set.back = !set.back; renderFlashcards(); } };
$('cardsNext').onclick = () => moveCard(1);
$('cardsPrev').onclick = () => moveCard(-1);
$('flashcards').addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveCard(1); }        // RTL: left is forward
  else if (e.key === 'ArrowRight') { e.preventDefault(); moveCard(-1); }
});
