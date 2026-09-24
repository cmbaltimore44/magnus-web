import * as logsApi from '../data/logs.js';
import { todayISO, addDays } from '../dates.js';
import { hashSegments } from '../hash.js';
import { getWeightUnit } from '../settings.js';
import { showError, showToast } from '../toast.js';
import { isMissingSchema, SCHEMA_003_HINT } from '../schema.js';

// Log: sleep, weight, mood and energy (one per day) plus workouts (several a
// day) for one date at a time, with the last 14 days underneath.

const HISTORY_DAYS = 14;
const SCALE = [1, 2, 3, 4, 5];

let userId = null;
let entries = []; // the HISTORY_DAYS days shown (always includes `date`)
let date = todayISO();
let dirty = false; // unsaved edits in the day form — refreshes leave it alone
const scaleValue = { mood: null, energy: null };
const el = {};

function cacheElements() {
  Object.assign(el, {
    dateLabel: document.getElementById('log-date-label'),
    dateInput: document.getElementById('log-date-input'),
    prevBtn: document.getElementById('log-prev-btn'),
    nextBtn: document.getElementById('log-next-btn'),
    todayBtn: document.getElementById('log-today-btn'),
    hint: document.getElementById('log-schema-hint'),
    content: document.getElementById('log-content'),
    form: document.getElementById('log-form'),
    sleep: document.getElementById('log-sleep'),
    weight: document.getElementById('log-weight'),
    weightLabel: document.getElementById('log-weight-label'),
    mood: document.getElementById('log-mood'),
    energy: document.getElementById('log-energy'),
    workouts: document.getElementById('log-workouts'),
    workoutForm: document.getElementById('log-workout-form'),
    workoutMinutes: document.getElementById('log-workout-minutes'),
    workoutType: document.getElementById('log-workout-type'),
    history: document.getElementById('log-history'),
  });
}

export function isLogDirty() {
  return dirty;
}

function dateFromHash() {
  const [view, d] = hashSegments();
  if (view !== 'log') return null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayISO();
}

function goTo(dateISO) {
  location.hash = dateISO === todayISO() ? '#/log' : '#/log/' + dateISO;
}

function dayEntries(dateISO, metric) {
  return entries.filter((e) => e.entry_date === dateISO && e.metric === metric);
}

function dayValue(dateISO, metric) {
  const e = dayEntries(dateISO, metric)[0];
  return e ? Number(e.value) : null;
}

function formatNumber(v) {
  return v == null ? '' : String(Math.round(v * 100) / 100);
}

// ---------- rendering ----------

function renderHeader() {
  const today = todayISO();
  el.dateInput.value = date;
  el.dateInput.max = today;
  el.nextBtn.disabled = date >= today;
  el.todayBtn.disabled = date === today;
  el.weightLabel.textContent = `Weight (${getWeightUnit()})`;
  const label = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  el.dateLabel.textContent = date === today ? `Today · ${label}` : label;
}

function renderScale(container, metric) {
  container.innerHTML = '';
  SCALE.forEach((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scale-btn' + (scaleValue[metric] === n ? ' selected' : '');
    btn.textContent = String(n);
    btn.setAttribute('aria-pressed', String(scaleValue[metric] === n));
    btn.setAttribute('aria-label', `${metric} ${n} of 5`);
    btn.addEventListener('click', () => {
      scaleValue[metric] = scaleValue[metric] === n ? null : n; // tap again to clear
      dirty = true;
      renderScale(container, metric);
    });
    container.appendChild(btn);
  });
}

function renderForm() {
  el.sleep.value = formatNumber(dayValue(date, 'sleep'));
  el.weight.value = formatNumber(dayValue(date, 'weight'));
  scaleValue.mood = dayValue(date, 'mood');
  scaleValue.energy = dayValue(date, 'energy');
  renderScale(el.mood, 'mood');
  renderScale(el.energy, 'energy');
  dirty = false;
}

function renderWorkouts() {
  el.workouts.innerHTML = '';
  const list = dayEntries(date, 'workout');
  if (!list.length) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint log-empty';
    hint.textContent = 'No workouts logged for this day.';
    el.workouts.appendChild(hint);
    return;
  }
  list.forEach((w) => {
    const row = document.createElement('li');
    row.className = 'routine-row log-workout-row';
    const name = document.createElement('span');
    name.className = 'routine-name';
    name.textContent = w.note || 'Workout';
    const mins = document.createElement('span');
    mins.className = 'routine-streak log-workout-minutes';
    mins.textContent = `${formatNumber(Number(w.value))} min`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'routine-remove';
    remove.textContent = '×';
    remove.title = 'Remove workout';
    remove.setAttribute('aria-label', 'Remove workout');
    remove.addEventListener('click', () => removeWorkout(w));
    row.append(name, mins, remove);
    el.workouts.appendChild(row);
  });
}

// The 14 days shown: ending today, or around the chosen date if it's older.
function historyEnd() {
  const today = todayISO();
  if (date >= addDays(today, -(HISTORY_DAYS - 1))) return today;
  return addDays(date, 7);
}

function renderHistory() {
  const end = historyEnd();
  const unit = getWeightUnit();
  const table = el.history;
  table.innerHTML = '';
  const head = table.createTHead().insertRow();
  ['Date', 'Sleep', `Weight`, 'Workout', 'Mood', 'Energy'].forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i === 2) th.title = `Weight (${unit})`;
    head.appendChild(th);
  });
  const body = table.createTBody();
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = addDays(end, -i);
    const row = body.insertRow();
    row.className = d === date ? 'selected' : '';
    row.tabIndex = 0;
    row.addEventListener('click', () => goTo(d));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goTo(d);
    });
    const dayLabel = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
    const workoutMins = dayEntries(d, 'workout').reduce((n, w) => n + Number(w.value), 0);
    const cells = [
      dayLabel,
      formatNumber(dayValue(d, 'sleep')),
      formatNumber(dayValue(d, 'weight')),
      workoutMins ? `${formatNumber(workoutMins)}m` : '',
      formatNumber(dayValue(d, 'mood')),
      formatNumber(dayValue(d, 'energy')),
    ];
    cells.forEach((text, j) => {
      const cell = row.insertCell();
      cell.textContent = text || (j ? '·' : '');
      if (j && !text) cell.className = 'log-blank';
    });
  }
}

function showSchemaHint(show) {
  el.hint.hidden = !show;
  el.content.hidden = show;
  if (show) el.hint.textContent = `The Log needs its database table. ${SCHEMA_003_HINT}`;
}

// ---------- saving ----------

function readNumber(input, { min, max }) {
  const raw = input.value.trim();
  if (!raw) return { value: null };
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || (max != null && v > max)) return { error: true };
  return { value: v };
}

async function handleSave(e) {
  e.preventDefault();
  const sleep = readNumber(el.sleep, { min: 0, max: 24 });
  const weight = readNumber(el.weight, { min: 0.1 });
  if (sleep.error) {
    showToast('Sleep should be between 0 and 24 hours.', { type: 'error' });
    return;
  }
  if (weight.error) {
    showToast('Weight should be a positive number.', { type: 'error' });
    return;
  }
  const values = { sleep: sleep.value, weight: weight.value, mood: scaleValue.mood, energy: scaleValue.energy };
  const changed = logsApi.DAILY_METRICS.filter((m) => values[m] !== dayValue(date, m));
  if (!changed.length) {
    dirty = false;
    showToast('Nothing new to save.', { type: 'info', duration: 2000 });
    return;
  }
  try {
    for (const metric of changed) await logsApi.setDailyMetric(userId, date, metric, values[metric]);
    dirty = false;
    showToast('Saved.', { type: 'success', duration: 2000 });
    await refreshLog({ force: true });
  } catch (err) {
    if (isMissingSchema(err)) showSchemaHint(true);
    else showError(err);
  }
}

async function handleAddWorkout(e) {
  e.preventDefault();
  const minutes = Number(el.workoutMinutes.value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    showToast('Workout minutes should be a positive number.', { type: 'error' });
    return;
  }
  try {
    await logsApi.addWorkout(userId, date, Math.round(minutes), el.workoutType.value.trim());
    el.workoutMinutes.value = '';
    el.workoutType.value = '';
    await refreshLog({ keepForm: true });
  } catch (err) {
    if (isMissingSchema(err)) showSchemaHint(true);
    else showError(err);
  }
}

async function removeWorkout(w) {
  try {
    await logsApi.deleteLogEntry(w.id);
    await refreshLog({ keepForm: true });
  } catch (err) {
    showError(err);
  }
}

// ---------- init / refresh ----------

export async function initLog(uid) {
  userId = uid;
  cacheElements();
  el.form.addEventListener('submit', handleSave);
  el.form.addEventListener('input', () => {
    dirty = true;
  });
  el.workoutForm.addEventListener('submit', handleAddWorkout);
  el.prevBtn.addEventListener('click', () => goTo(addDays(date, -1)));
  el.nextBtn.addEventListener('click', () => {
    if (date < todayISO()) goTo(addDays(date, 1));
  });
  el.todayBtn.addEventListener('click', () => goTo(todayISO()));
  el.dateInput.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(el.dateInput.value)) goTo(el.dateInput.value);
  });
}

// force: re-fill the day form even with unsaved edits; keepForm: never.
export async function refreshLog({ force = false, keepForm = false } = {}) {
  const hashDate = dateFromHash() || todayISO();
  const dateChanged = hashDate !== date;
  date = hashDate;
  renderHeader();
  const end = historyEnd();
  try {
    entries = await logsApi.listLogEntries(addDays(end, -(HISTORY_DAYS - 1)), end);
  } catch (err) {
    if (isMissingSchema(err)) showSchemaHint(true);
    else showError(err);
    return;
  }
  showSchemaHint(false);
  if (dateChanged || force || (!dirty && !keepForm)) renderForm();
  renderWorkouts();
  renderHistory();
}
