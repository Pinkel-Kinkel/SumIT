// Pomodoro timer: the state machine, with no DOM (so it can be tested in Node). It counts with absolute timestamps, so a
// window that is paused, hidden or put to sleep does not make it drift. pomodoro-ui.js shows it in the sidebar.
(function (root) {
  const PRESETS = {
    classic: { focus: 25, short: 5, long: 15, rounds: 4 },
    deep: { focus: 50, short: 10, long: 20, rounds: 3 },
    quick: { focus: 15, short: 3, long: 10, rounds: 4 },
  };
  const LIMITS = { focus: [1, 120], short: [1, 60], long: [1, 90], rounds: [2, 8] };
  const STALE_MS = 10 * 60 * 1000;   // a phase that ended this long ago is not followed by an automatic break

  const SOUNDS = ['bell', 'soft', 'beep'];
  const clamp = (v, [lo, hi], d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  // The student's settings, with every missing or invalid value replaced by the classic one.
  function config(c) {
    c = c && typeof c === 'object' ? c : {};
    const base = PRESETS[c.preset] || PRESETS.classic;
    const custom = c.preset === 'custom';
    return {
      preset: custom || PRESETS[c.preset] ? c.preset : 'classic',
      focus: custom ? clamp(c.focus, LIMITS.focus, PRESETS.classic.focus) : base.focus,
      short: custom ? clamp(c.short, LIMITS.short, PRESETS.classic.short) : base.short,
      long: custom ? clamp(c.long, LIMITS.long, PRESETS.classic.long) : base.long,
      rounds: custom ? clamp(c.rounds, LIMITS.rounds, PRESETS.classic.rounds) : base.rounds,
      auto: c.auto !== false, sound: c.sound !== false, notify: c.notify !== false,
      soundKind: SOUNDS.includes(c.soundKind) ? c.soundKind : 'bell', volume: clamp(c.volume, [10, 100], 60),
    };
  }

  const durationMs = (phase, cfg) => (phase === 'long' ? cfg.long : phase === 'short' ? cfg.short : cfg.focus) * 60000;
  const initial = () => ({ phase: 'idle', running: false, endsAt: null, remainingMs: null, round: 1, label: '' });

  // A state read back from storage: only known fields, numbers that are numbers.
  function sanitize(s, cfg) {
    const phases = ['idle', 'focus', 'short', 'long'];
    if (!s || typeof s !== 'object' || !phases.includes(s.phase) || s.phase === 'idle') return initial();
    const out = { phase: s.phase, running: s.running === true, endsAt: null, remainingMs: null, round: clamp(s.round, [1, cfg.rounds], 1), label: String(s.label || '').slice(0, 120) };
    if (out.running && Number.isFinite(s.endsAt)) out.endsAt = s.endsAt;
    else { out.running = false; out.remainingMs = Number.isFinite(s.remainingMs) ? Math.max(0, Math.min(s.remainingMs, durationMs(s.phase, cfg))) : durationMs(s.phase, cfg); }
    return out;
  }

  const remaining = (s, cfg, now) => (s.phase === 'idle' ? durationMs('focus', cfg) : s.running ? Math.max(0, s.endsAt - now) : s.remainingMs);
  const progress = (s, cfg, now) => (s.phase === 'idle' ? 0 : Math.min(1, Math.max(0, 1 - remaining(s, cfg, now) / durationMs(s.phase, cfg))));

  // A new focus round, running, for the thing the student is about to work on.
  function start(s, cfg, now, label) {
    const keep = s.phase === 'idle' ? 1 : s.round;
    return { phase: 'focus', running: true, endsAt: now + durationMs('focus', cfg), remainingMs: null, round: keep, label: String(label || s.label || '').slice(0, 120) };
  }

  function pause(s, now) {
    if (!s.running) return s;
    return Object.assign({}, s, { running: false, remainingMs: Math.max(0, s.endsAt - now), endsAt: null });
  }

  function resume(s, now) {
    if (s.running || s.phase === 'idle') return s;
    return Object.assign({}, s, { running: true, endsAt: now + s.remainingMs, remainingMs: null });
  }

  // What follows the current phase: a break after a focus round (a long one every `rounds` rounds), a focus after a break.
  // A break starts by itself when asked to; a focus round always waits for the student.
  function advance(s, cfg, now, auto) {
    if (s.phase === 'idle') return s;
    if (s.phase === 'focus') {
      const phase = s.round % cfg.rounds === 0 ? 'long' : 'short';
      const run = !!auto;
      return { phase, running: run, endsAt: run ? now + durationMs(phase, cfg) : null, remainingMs: run ? null : durationMs(phase, cfg), round: s.round, label: s.label };
    }
    return { phase: 'focus', running: false, endsAt: null, remainingMs: durationMs('focus', cfg), round: s.phase === 'long' ? 1 : s.round + 1, label: s.label };
  }

  function skip(s, cfg, now) { return advance(s, cfg, now, cfg.auto); }
  function reset() { return initial(); }

  // Call every second while running. Returns { state, event }: event is { type: 'end', phase, next } once, when a phase ends.
  function tick(s, cfg, now) {
    if (!s.running || now < s.endsAt) return { state: s, event: null };
    const late = now - s.endsAt;
    const next = advance(s, cfg, now, cfg.auto && late < STALE_MS);
    return { state: next, event: { type: 'end', phase: s.phase, next: next.phase, late } };
  }

  const fmt = (ms) => { const t = Math.ceil(Math.max(0, ms) / 1000); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

  const api = { PRESETS, SOUNDS, config, durationMs, initial, sanitize, remaining, progress, start, pause, resume, skip, reset, tick, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pomodoro = api;
})(typeof window !== 'undefined' ? window : globalThis);
