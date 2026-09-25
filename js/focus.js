import * as focusApi from './data/focus.js';
import * as tasksApi from './data/tasks.js';
import * as pomo from './pomodoro.js';
import { getPomodoroSettings } from './settings.js';
import { showError, showToast } from './toast.js';
import { notifyDataChanged } from './events.js';
import { isMissingSchema, SCHEMA_003_HINT } from './schema.js';
import { openPicker } from './search.js';
import { focusChoices, typedChoice } from './focusPicker.js';

// Pomodoro focus timer: focus → break → … with a long break after every few
// rounds (the rules are in js/pomodoro.js, shared with Magnus). A small pill
// stays visible across views. When a phase's time is up it waits (chime +
// notification) until you start the next phase or add 5 minutes. The timer
// object lives in localStorage so it survives a reload; focus minutes are
// saved to focus_sessions when you leave a focus phase (next, skip or stop),
// or switch task in the middle of one. A timer can be on a task, on a label
// ("job apps": anything typed in the picker), or on nothing in particular.

const STATE_KEY = 'kanban.pomodoro';
const OLD_STATE_KEY = 'kanban.focusTimer'; // pre-Pomodoro single countdown
const NOTIFY_ASKED_KEY = 'kanban.notifyAsked';

const PHONE = window.matchMedia('(max-width: 720px)');

let userId = null;
let timer = null; // see js/pomodoro.js
let ticker = null;
let expanded = false; // phone: the pill opened up to show every button
let audio = null;
const baseTitle = document.title;
const el = {};
const listeners = new Set();

// ---------- storage ----------

function validTimer(t) {
  return (
    !!t &&
    typeof t === 'object' &&
    ['focus', 'short', 'long'].includes(t.phase) &&
    ['running', 'ended'].includes(t.status) &&
    Number.isFinite(t.startedAt) &&
    Number.isFinite(t.minutes) &&
    t.minutes > 0 &&
    Number.isInteger(t.round) &&
    t.round >= 0
  );
}

// The old format: { taskId, taskTitle, startedAt (ISO), durationMs,
// elapsedMs, runningSince }. Becomes a focus round with the same time left.
function migrateOld(old, now) {
  if (!old || !old.durationMs || !Number.isFinite(old.elapsedMs)) return null;
  const elapsed = Math.max(0, old.elapsedMs + (old.runningSince ? now - old.runningSince : 0));
  const start = Date.parse(old.startedAt);
  const startedAt = Number.isFinite(start) && start <= now - elapsed ? start : now - elapsed;
  return {
    taskId: old.taskId ?? null,
    title: old.taskTitle ?? null,
    phase: 'focus',
    round: 0,
    startedAt,
    minutes: old.durationMs / 60000,
    pausedAt: old.runningSince ? null : now,
    pausedMs: now - startedAt - elapsed,
    status: 'running',
  };
}

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function load(now) {
  const saved = readJSON(STATE_KEY);
  if (validTimer(saved)) return saved;
  const old = readJSON(OLD_STATE_KEY);
  try {
    localStorage.removeItem(OLD_STATE_KEY);
    localStorage.removeItem(STATE_KEY); // unreadable (if anything): drop it
  } catch {
    // storage unavailable
  }
  const migrated = migrateOld(old, now);
  return validTimer(migrated) ? migrated : null;
}

function save() {
  try {
    if (timer) localStorage.setItem(STATE_KEY, JSON.stringify(timer));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    // storage unavailable: the timer still runs, it just won't survive a reload
  }
}

// ---------- chime + notification ----------

// Called from user gestures (start, pill buttons) so iOS lets it play later.
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audio) audio = new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
}

function chime() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t0 = audio.currentTime + 0.02;
    [0, 0.28].forEach((offset, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = i ? 1046.5 : 784; // G5 then C6
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.4);
    });
  } catch {
    // no sound; the pill still shows it
  }
}

// Asked once per device, the first time a timer is started (a user gesture).
function askNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem(NOTIFY_ASKED_KEY)) return;
    localStorage.setItem(NOTIFY_ASKED_KEY, '1');
  } catch {
    return;
  }
  try {
    const p = Notification.requestPermission();
    if (p && p.catch) p.catch(() => {});
  } catch {
    // old callback-only API; skip
  }
}

async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const icon = document.querySelector('link[rel="apple-touch-icon"]')?.href;
  const options = { body, tag: 'life-tracker-focus', renotify: true, ...(icon ? { icon } : {}) };
  try {
    // Home-screen apps on iOS only support notifications via the service worker.
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) {
      await reg.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    // not allowed here; the chime and the pill still tell you
  }
}

// ---------- saving focus time ----------

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// “Draft Q4” / “job apps”, or "no task".
const named = (title) => (title ? `“${title}”` : 'no task');

// True if saved. `quiet`: no "Saved …" toast (the caller says it instead).
// Before schema_005 a label can't be stored: the time is saved without it.
async function record(log, title, { quiet = false } = {}) {
  if (!log || log.minutes < 1) return false;
  try {
    const row = await focusApi.createFocusSession(userId, {
      task_id: log.taskId,
      started_at: new Date(log.startedAt).toISOString(),
      minutes: log.minutes,
      label: log.label,
    });
    notifyDataChanged('focus');
    if (row?.labelDropped) {
      showToast(`Focus logged without its label “${log.label}”: run supabase/schema_005.sql to keep labels`, { type: 'error', duration: 7000 });
      return true;
    }
    if (!quiet) showToast(`Saved ${formatMinutes(log.minutes)} of focus${title ? ` on “${title}”` : ''}.`, { type: 'success', duration: 3000 });
    return true;
  } catch (err) {
    if (isMissingSchema(err)) showToast(`Focus session not saved. ${SCHEMA_003_HINT}`, { type: 'info', duration: 7000 });
    else showError(err);
    return false;
  }
}

// ---------- rendering ----------

function nextLabel(t, settings) {
  return pomo.nextPhaseOf(t, settings).phase === 'focus' ? 'Start focus' : 'Start break';
}

// Mid-round, switching logs the time so far; otherwise it's for the next round.
const focusing = (t) => t.phase === 'focus' && t.status === 'running';

// Labels for switching task (same as Magnus's T menu); unassign is null
// when there's no task or label to take off.
function switchLabels(t) {
  const during = focusing(t);
  return {
    switch: during ? 'Switch task… (logs the time so far to this one)' : 'Switch task…',
    unassign: t.taskId || t.label ? (during ? 'Focus on no task (logs the time so far)' : 'Focus on no task') : null,
  };
}

function render() {
  listeners.forEach((fn) => fn());
  document.body.classList.toggle('focus-pill-open', !!timer);
  if (!timer) {
    el.pill.hidden = true;
    el.todayBtn.hidden = false;
    document.title = baseTitle;
    expanded = false;
    return;
  }
  const settings = getPomodoroSettings();
  const ended = timer.status === 'ended';
  const paused = !ended && !!timer.pausedAt;
  const label = pomo.phaseLabel(timer, settings);
  const clock = pomo.formatClock(pomo.remainingMs(timer, Date.now()));

  el.pill.hidden = false;
  el.todayBtn.hidden = true;
  el.pill.classList.toggle('ended', ended);
  el.pill.classList.toggle('paused', paused);
  el.pill.classList.toggle('on-break', timer.phase !== 'focus');
  el.pill.classList.toggle('expanded', expanded);
  el.summary.setAttribute('aria-expanded', String(expanded || !PHONE.matches));
  el.summary.title = PHONE.matches ? (expanded ? 'Show fewer buttons' : 'Show all timer buttons') : '';
  el.label.textContent = label;
  el.time.textContent = ended ? 'Time’s up' : paused ? `${clock} paused` : clock;
  el.task.textContent = timer.title || '';
  el.task.title = timer.title || '';
  el.task.hidden = !timer.title;

  el.nextBtn.hidden = !ended;
  el.nextBtn.textContent = nextLabel(timer, settings);
  el.pauseBtn.hidden = ended;
  el.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  el.skipBtn.hidden = ended;
  el.skipBtn.title = timer.phase === 'focus' ? 'End this focus round now and start the break' : 'End the break now and start focusing';
  el.extendBtn.textContent = ended ? '+5 min' : '+5';
  el.switchBtn.title = switchLabels(timer).switch;
  // Phone, collapsed: only the main action is shown next to the clock.
  el.nextBtn.classList.toggle('focus-pill-main', ended);
  el.pauseBtn.classList.toggle('focus-pill-main', !ended);

  document.title = `${ended ? `${label} done` : paused ? 'Paused' : clock} · ${baseTitle}`;
  // Phone: toasts sit just above the pill (style.css).
  document.documentElement.style.setProperty('--focus-pill-h', `${el.pill.offsetHeight}px`);
}

function announce(text) {
  el.status.textContent = text;
}

// ---------- timer changes ----------

function set(next) {
  timer = next;
  save();
  if (timer && timer.status === 'running') startTicker();
  else stopTicker();
  render();
}

function tick() {
  if (!timer) return;
  if (pomo.isDue(timer, Date.now())) {
    const settings = getPomodoroSettings();
    const label = pomo.phaseLabel(timer, settings);
    const next = nextLabel(timer, settings);
    const body = timer.phase === 'focus' ? `Time for a break. Tap ${next} when you’re ready.` : 'Break’s over. Tap Start focus when you’re ready.';
    set(pomo.endPhase(timer));
    chime();
    notify(`${label} done`, body);
    announce(`${label} done. ${next}, or add 5 minutes.`);
    return;
  }
  render();
}

function startTicker() {
  if (!ticker) ticker = setInterval(tick, 1000);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

export function isFocusRunning() {
  return !!timer;
}

// For the command palette: what applies right now (null = no timer).
export function timerState() {
  if (!timer) return null;
  return {
    ended: timer.status === 'ended',
    paused: !!timer.pausedAt,
    phase: timer.phase,
    nextLabel: nextLabel(timer, getPomodoroSettings()),
    switchLabels: switchLabels(timer),
  };
}

export function onTimerChange(fn) {
  listeners.add(fn);
}

// `to`: a task { id, title }, a label { label }, or null for nothing in
// particular. Focusing on something while a timer runs switches the timer to it.
export async function startFocus(to = null) {
  if (timer && to) return switchFocus(to);
  unlockAudio();
  askNotificationPermission();
  const now = Date.now();
  const prev = timer;
  // One timer at a time: keep what's been done, stay in the same cycle.
  const round = prev ? (prev.phase === 'long' ? 0 : prev.round) : 0;
  set(pomo.startFocus(to, getPomodoroSettings(), now, round));
  showToast(`Focus: ${formatMinutes(timer.minutes)}${timer.title ? ` on ${named(timer.title)}` : ''}.`, { type: 'info', duration: 2500 });
  if (prev) await record(pomo.stop(prev, now), prev.title);
}

// Keep the clock and round, change what it's on (a task, a label, or null).
export async function switchFocus(to = null) {
  if (!timer) return;
  const prev = timer;
  if (pomo.sameTarget(prev, to)) {
    const text = to ? `Already focusing on ${named(to.id ? to.title : to.label.trim())}` : 'Not focusing on anything in particular already';
    showToast(text, { type: 'info', duration: 2500 });
    return;
  }
  const { timer: next, log } = pomo.switchTask(prev, to, Date.now());
  set(next);
  const logged = await record(log, prev.title, { quiet: true });
  const when = focusing(prev) ? 'Now focusing on' : 'Next focus round: on';
  const text = `${when} ${named(next.title)}${logged ? ` · logged ${formatMinutes(log.minutes)} to ${named(prev.title)}` : ''}`;
  showToast(text, { type: 'success', duration: 3000 });
  announce(text);
}

// What to focus on, for starting a timer (no timer yet) or Switch… (one
// running): starred tasks, recent labels, the other open tasks, or anything
// typed (it becomes the label).
export async function openFocusPicker() {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  let tasks;
  let sessions;
  try {
    [tasks, sessions] = await Promise.all([
      tasksApi.listTasks(),
      focusApi.listFocusSessions(since).catch(() => []), // no schema_003 yet: no recent labels
    ]);
  } catch (err) {
    showError(err);
    return;
  }
  const current = timer;
  const choices = focusChoices({
    tasks: tasks.filter((t) => t.status !== 'done'),
    labels: focusApi.recentLabels(sessions),
    timer: current,
  });
  const starred = new Set(tasks.filter((t) => t.is_starred).map((t) => t.id));
  const pick = (to) => (timer ? switchFocus(to) : startFocus(to));
  const item = (c) => ({
    title: c.id === 'none' && current ? switchLabels(current).unassign : c.label,
    subtitle: [
      c.group === 'Now' ? 'Focusing on this now' : '',
      starred.has(c.to?.id) ? '★ Starred' : '',
      c.group === 'Recent' ? 'Recent' : '',
      c.hint || '',
    ]
      .filter(Boolean)
      .join(' · '),
    run: () => pick(c.to),
  });
  openPicker({
    label: 'Focus timer',
    placeholder: `${current ? 'Switch the focus timer to' : 'Focus on'}… a task, or type anything (job apps, an essay…)`,
    items: choices.map(item),
    typed: (text) => {
      const c = typedChoice(text, choices);
      return c ? item(c) : null;
    },
    empty: 'Nothing matches.',
  });
}

// Start the next phase (after time's up), or skip ahead while running.
export async function advanceTimer() {
  if (!timer) return;
  unlockAudio();
  const prev = timer;
  const settings = getPomodoroSettings();
  const { timer: next, log } = pomo.advance(prev, settings, Date.now());
  set(next);
  announce(`${pomo.phaseLabel(next, settings)} started.`);
  await record(log, prev.title);
}

export function togglePauseTimer() {
  if (!timer || timer.status !== 'running') return;
  unlockAudio();
  set(pomo.togglePause(timer, Date.now()));
}

export function extendTimer() {
  if (!timer) return;
  unlockAudio();
  set(pomo.extend(timer, Date.now(), 5));
}

export async function stopFocus() {
  if (!timer) return;
  const prev = timer;
  const log = pomo.stop(prev, Date.now());
  set(null);
  if (!log) {
    const msg = prev.phase === 'focus' ? 'Focus stopped (under a minute, not saved).' : 'Timer stopped.';
    showToast(msg, { type: 'info', duration: 2500 });
  }
  await record(log, prev.title);
}

function toggleExpanded() {
  if (!PHONE.matches) return;
  expanded = !expanded;
  render();
}

export function initFocus(uid) {
  userId = uid;
  Object.assign(el, {
    pill: document.getElementById('focus-pill'),
    summary: document.getElementById('focus-pill-summary'),
    label: document.getElementById('focus-pill-label'),
    task: document.getElementById('focus-pill-task'),
    time: document.getElementById('focus-pill-time'),
    status: document.getElementById('focus-pill-status'),
    nextBtn: document.getElementById('focus-next-btn'),
    pauseBtn: document.getElementById('focus-pause-btn'),
    skipBtn: document.getElementById('focus-skip-btn'),
    extendBtn: document.getElementById('focus-extend-btn'),
    switchBtn: document.getElementById('focus-switch-btn'),
    stopBtn: document.getElementById('focus-stop-btn'),
    todayBtn: document.getElementById('today-focus-btn'),
  });
  el.nextBtn.addEventListener('click', advanceTimer);
  el.pauseBtn.addEventListener('click', togglePauseTimer);
  el.skipBtn.addEventListener('click', advanceTimer);
  el.extendBtn.addEventListener('click', extendTimer);
  el.switchBtn.addEventListener('click', openFocusPicker);
  el.stopBtn.addEventListener('click', stopFocus);
  el.summary.addEventListener('click', toggleExpanded);
  el.todayBtn.addEventListener('click', openFocusPicker);
  PHONE.addEventListener('change', () => {
    expanded = false;
    render();
  });

  const now = Date.now();
  timer = load(now);
  // Time ran out while the app was closed: wait for a choice, don't advance.
  if (timer && pomo.isDue(timer, now)) timer = pomo.endPhase(timer);
  set(timer);

  // Timers are throttled in background tabs; catch up as soon as we're back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  // Another tab changed the timer.
  window.addEventListener('storage', (e) => {
    if (e.key !== STATE_KEY) return;
    const saved = readJSON(STATE_KEY);
    timer = validTimer(saved) ? saved : null;
    if (timer && timer.status === 'running') startTicker();
    else stopTicker();
    render();
  });
}
