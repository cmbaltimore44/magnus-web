import * as focusApi from './data/focus.js';
import { getFocusMinutes } from './settings.js';
import { showError, showToast } from './toast.js';
import { notifyDataChanged } from './events.js';
import { isMissingSchema, SCHEMA_003_HINT } from './schema.js';

// Focus timer on a task: a countdown in a small bar that stays visible across
// views. State lives in localStorage so it survives a reload; when it ends
// (or is stopped after at least a minute) a focus_sessions row is saved.

const STATE_KEY = 'kanban.focusTimer';

let userId = null;
let state = null; // { taskId, taskTitle, startedAt, durationMs, elapsedMs, runningSince }
let ticker = null;
const baseTitle = document.title;
const el = {};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    return raw && raw.durationMs ? raw : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    // storage unavailable: the timer still runs, it just won't survive a reload
  }
}

function elapsedMs(now = Date.now()) {
  if (!state) return 0;
  return state.elapsedMs + (state.runningSince ? now - state.runningSince : 0);
}

function remainingMs() {
  return state ? Math.max(0, state.durationMs - elapsedMs()) : 0;
}

function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function render() {
  if (!state) {
    el.pill.hidden = true;
    document.title = baseTitle;
    return;
  }
  el.pill.hidden = false;
  const clock = formatClock(remainingMs());
  el.task.textContent = state.taskTitle;
  el.task.title = state.taskTitle;
  el.time.textContent = clock;
  const paused = !state.runningSince;
  el.pill.classList.toggle('paused', paused);
  el.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  document.title = `${paused ? 'Paused' : clock} · ${baseTitle}`;
}

function tick() {
  if (!state) return;
  if (remainingMs() <= 0) {
    finish();
    return;
  }
  render();
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
}

async function record(session, minutes) {
  if (minutes < 1) return false;
  try {
    await focusApi.createFocusSession(userId, {
      task_id: session.taskId,
      started_at: session.startedAt,
      minutes,
    });
    notifyDataChanged('focus');
    return true;
  } catch (err) {
    if (isMissingSchema(err)) showToast(`Focus session not saved. ${SCHEMA_003_HINT}`, { type: 'info', duration: 7000 });
    else showError(err);
    return false;
  }
}

async function finish() {
  const session = state;
  state = null;
  save();
  clearInterval(ticker);
  render();
  const minutes = Math.round(session.durationMs / 60000);
  if (await record(session, minutes)) {
    showToast(`Focus done: ${formatMinutes(minutes)} on “${session.taskTitle}”.`, { type: 'success', duration: 8000 });
  }
}

export async function stopFocus() {
  if (!state) return;
  const session = state;
  const minutes = Math.floor(elapsedMs() / 60000);
  state = null;
  save();
  clearInterval(ticker);
  render();
  if (minutes < 1) {
    showToast('Focus stopped (under a minute, not saved).', { type: 'info', duration: 3000 });
    return;
  }
  if (await record(session, minutes)) {
    showToast(`Saved ${formatMinutes(minutes)} of focus on “${session.taskTitle}”.`, { type: 'success' });
  }
}

function togglePause() {
  if (!state) return;
  if (state.runningSince) {
    state.elapsedMs = elapsedMs();
    state.runningSince = null;
  } else {
    state.runningSince = Date.now();
  }
  save();
  render();
}

export async function startFocus(task, minutes = getFocusMinutes()) {
  if (state) await stopFocus(); // one timer at a time; keep what's been done
  const now = Date.now();
  state = {
    taskId: task.id,
    taskTitle: task.title,
    startedAt: new Date(now).toISOString(),
    durationMs: minutes * 60000,
    elapsedMs: 0,
    runningSince: now,
  };
  save();
  startTicker();
  render();
  showToast(`Focusing on “${task.title}” for ${formatMinutes(minutes)}.`, { type: 'info', duration: 3000 });
}

export function initFocus(uid) {
  userId = uid;
  Object.assign(el, {
    pill: document.getElementById('focus-pill'),
    task: document.getElementById('focus-pill-task'),
    time: document.getElementById('focus-pill-time'),
    pauseBtn: document.getElementById('focus-pause-btn'),
    stopBtn: document.getElementById('focus-stop-btn'),
  });
  el.pauseBtn.addEventListener('click', togglePause);
  el.stopBtn.addEventListener('click', stopFocus);

  state = load();
  if (state) {
    startTicker();
    tick(); // finishes right away if it ran out while the app was closed
  }
  render();

  // Timers are throttled in background tabs; catch up as soon as we're back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}
