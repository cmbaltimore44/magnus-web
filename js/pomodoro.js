// COPY of magnus/src/lib/pomodoro.js (~/Development/magnus). Keep the two
// files identical below this block: change both, or neither.
//
// Pomodoro engine shared by Magnus and the web app (Magnus Web has a copy,
// js/pomodoro.js — keep the two in sync). Pure functions over a plain,
// JSON-safe timer object, so it can be saved (prefs.json / localStorage)
// and survive restarts.
//
// Cycle: focus → short break → focus → … and a long break after every
// `every` focus rounds. When a phase's time is up it *waits* (status
// 'ended') until you choose: start the next phase, or add 5 minutes.
// Skip ends the current phase early and starts the next one.
// Focus time is logged when you leave a focus phase (next, skip or stop),
// counting only the time actually spent (pauses and waiting excluded).
// Switching task mid-round logs the time so far to the old task and keeps
// the clock and round going for the new one.
//
// timer = {
//   taskId, title,            // task being focused on (both may be null)
//   label,                    // or a label instead of a task ("job apps"); title = label then
//   phase: 'focus' | 'short' | 'long',
//   round,                    // focus rounds finished in this cycle (0..every)
//   startedAt,                // ms when this phase started
//   minutes,                  // phase length (grows with +5)
//   pausedAt, pausedMs,       // pause bookkeeping
//   loggedMs, segmentAt,      // focus already logged this round (task switches), and when the current task took over
//   status: 'running' | 'ended',
// }

export const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4 };
export const PHASE_LABELS = { focus: 'Focus', short: 'Break', long: 'Long break' };

export function settingsFrom(raw = {}) {
  const pick = (k, lo, hi) => {
    const n = Number(raw[k]);
    return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : DEFAULTS[k];
  };
  return { focus: pick('focus', 1, 180), short: pick('short', 1, 60), long: pick('long', 1, 90), every: pick('every', 1, 12) };
}

// What a timer can focus on: a task { id, title }, a label { label }, or null.
function target(to) {
  const label = !to?.id && to?.label ? String(to.label).trim().slice(0, 120) || null : null;
  return { taskId: to?.id ?? null, title: to?.id ? to.title ?? null : label, label };
}

export function sameTarget(t, to) {
  const x = target(to);
  return t.taskId === x.taskId && (t.label ?? null) === x.label;
}

export function startFocus(to, settings, now, round = 0) {
  return {
    ...target(to),
    phase: 'focus',
    round,
    startedAt: now,
    minutes: settings.focus,
    pausedAt: null,
    pausedMs: 0,
    loggedMs: 0,
    segmentAt: null,
    status: 'running',
  };
}

export function elapsedMs(t, now) {
  if (!t) return 0;
  const end = t.pausedAt ?? now;
  return Math.min(t.minutes * 60000, Math.max(0, end - t.startedAt - (t.pausedMs || 0)));
}

export function remainingMs(t, now) {
  return Math.max(0, t.minutes * 60000 - elapsedMs(t, now));
}

// Time's up on a running phase? (Call on each tick; then use endPhase.)
export function isDue(t, now) {
  return t?.status === 'running' && !t.pausedAt && remainingMs(t, now) === 0;
}

export function endPhase(t) {
  return { ...t, status: 'ended', pausedAt: null };
}

export function togglePause(t, now) {
  if (t.status !== 'running') return t;
  if (t.pausedAt) return { ...t, pausedMs: (t.pausedMs || 0) + (now - t.pausedAt), pausedAt: null };
  return { ...t, pausedAt: now };
}

// +5 minutes: on a finished phase it runs again for 5 more; on a running one
// it just gets longer.
export function extend(t, now, minutes = 5) {
  if (t.status === 'ended') {
    // restart the clock so the phase has exactly `minutes` left
    const spent = t.minutes * 60000;
    return { ...t, status: 'running', minutes: t.minutes + minutes, startedAt: now - spent, pausedMs: 0, pausedAt: null };
  }
  return { ...t, minutes: t.minutes + minutes };
}

// The focus log for leaving `t` now: { taskId, startedAt, minutes } or null.
// After a task switch, only the time since the last one counts.
export function focusLog(t, now) {
  if (t?.phase !== 'focus') return null;
  const minutes = Math.floor((elapsedMs(t, now) - (t.loggedMs || 0)) / 60000);
  return minutes >= 1 ? { taskId: t.taskId, label: t.label ?? null, startedAt: t.segmentAt ?? t.startedAt, minutes } : null;
}

// Focus on a different task, a label, or nothing, without restarting anything.
// Returns { timer, log }: in a focus round, log is the old task's time so
// far (whole minutes; leftover seconds go to the new task). In a break, or
// a phase waiting to be advanced, it just changes the next round's task.
export function switchTask(t, to, now) {
  const log = focusLog(t, now);
  const timer = { ...t, ...target(to) };
  if (log) {
    timer.loggedMs = (t.loggedMs || 0) + log.minutes * 60000;
    timer.segmentAt = now;
  }
  return { timer, log };
}

export function nextPhaseOf(t, settings) {
  if (t.phase !== 'focus') return { phase: 'focus', round: t.phase === 'long' ? 0 : t.round };
  const round = t.round + 1;
  return { phase: round >= settings.every ? 'long' : 'short', round };
}

// Start the next phase now (after a finished phase, or as a skip).
// Returns { timer, log } — log is the focus session to save, if any.
export function advance(t, settings, now) {
  const log = focusLog(t, now);
  const { phase, round } = nextPhaseOf(t, settings);
  const base = phase === 'focus' ? startFocus(t.taskId ? { id: t.taskId, title: t.title } : t.label ? { label: t.label } : null, settings, now, round) : null;
  const timer = base || { ...t, phase, round, startedAt: now, minutes: settings[phase], pausedAt: null, pausedMs: 0, status: 'running' };
  return { timer, log };
}

// Stop entirely. Returns the focus session to save, if any.
export function stop(t, now) {
  return focusLog(t, now);
}

export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// e.g. "Focus 2/4", "Break", "Long break"
export function phaseLabel(t, settings) {
  return t.phase === 'focus' ? `Focus ${Math.min(t.round + 1, settings.every)}/${settings.every}` : PHASE_LABELS[t.phase];
}
