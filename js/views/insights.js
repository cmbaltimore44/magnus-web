import { supabase } from '../supabaseClient.js';
import * as routinesApi from '../data/routines.js';
import * as completionsApi from '../data/completions.js';
import * as booksApi from '../data/books.js';
import * as focusApi from '../data/focus.js';
import * as logsApi from '../data/logs.js';
import { completedByWeek, focusByWeek, routineRates, metricSeries, average, bookStats } from '../stats.js';
import { todayISO, addDays } from '../dates.js';
import { statTiles, section, barList, columnChart, note } from '../charts.js';
import { formatMinutes } from '../focus.js';
import { showError } from '../toast.js';
import { isMissingSchema, SCHEMA_003_HINT } from '../schema.js';

// Insights: tasks finished per week, routine consistency, focus time, the
// Log's mood/energy/sleep trends, and books finished this year.

const WEEKS = 8;
const DAYS = 30;

const el = {};

// Resolves to { data } or { missing: true } (table/column not there yet).
async function optional(promise) {
  try {
    return { data: await promise };
  } catch (err) {
    if (isMissingSchema(err)) return { missing: true };
    throw err;
  }
}

async function listCompletedTasks() {
  const { data, error } = await supabase.from('tasks').select('id, status, completed_at').eq('status', 'done');
  if (error) throw error;
  return data;
}

function shortDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

function weekTitle(start) {
  return `Week of ${new Date(start + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function fmt(v, digits = 1) {
  return v == null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits);
}

function trendSection(title, entries, metric, today, { unit = '', max } = {}) {
  const series = metricSeries(entries, metric, today, DAYS);
  const avg = average(series.map((p) => p.value));
  const logged = series.filter((p) => p.value != null).length;
  if (!logged) return section(title, 'Nothing logged in the last 30 days.');
  const points = series.map((p) => ({
    label: shortDate(p.date),
    value: p.value,
    title: `${shortDate(p.date)}: ${p.value == null ? 'not logged' : fmt(p.value, 2) + unit}`,
  }));
  return section(
    title,
    note(`Average ${fmt(avg)}${unit} over ${logged} logged day${logged === 1 ? '' : 's'} (last 30 days).`),
    columnChart(points, { max, labelEvery: 7, showValues: false })
  );
}

async function render() {
  const today = todayISO();
  const since = addDays(today, -(WEEKS * 7 + 7));
  const [tasks, routines, completions, books, focus, log] = await Promise.all([
    optional(listCompletedTasks()),
    routinesApi.listRoutines(),
    completionsApi.listCompletions(),
    booksApi.listBooks(),
    optional(focusApi.listFocusSessions(new Date(since + 'T00:00:00').toISOString())),
    optional(logsApi.listLogEntries(addDays(today, -(DAYS - 1)), today)),
  ]);

  const done = tasks.missing ? null : completedByWeek(tasks.data, today, WEEKS);
  const focusWeeks = focus.missing ? null : focusByWeek(focus.data, today, WEEKS);
  const rates = routineRates(routines, completions, today, DAYS);
  const overallRate = rates.length ? rates.reduce((n, r) => n + r.rate, 0) / rates.length : null;
  const reading = bookStats(books, today);

  el.body.innerHTML = '';
  el.body.appendChild(
    statTiles([
      { label: 'Tasks done this week', value: done ? done[done.length - 1].count : '—' },
      { label: 'Focus this week', value: focusWeeks ? formatMinutes(focusWeeks[focusWeeks.length - 1].minutes) : '—' },
      { label: 'Routines, last 30 days', value: overallRate == null ? '—' : `${Math.round(overallRate * 100)}%` },
      { label: `Books finished in ${today.slice(0, 4)}`, value: reading.finishedThisYear },
    ])
  );

  el.body.appendChild(
    done
      ? section(
          'Tasks completed per week',
          columnChart(done.map((w) => ({ label: shortDate(w.start), value: w.count, title: `${weekTitle(w.start)}: ${w.count}` }))),
          note('Only counts tasks finished since schema_003 was set up; older ones have no completion time.')
        )
      : section('Tasks completed per week', SCHEMA_003_HINT)
  );

  el.body.appendChild(
    focusWeeks
      ? section(
          'Focus minutes per week',
          columnChart(
            focusWeeks.map((w) => ({ label: shortDate(w.start), value: w.minutes, title: `${weekTitle(w.start)}: ${formatMinutes(w.minutes)}` }))
          )
        )
      : section('Focus minutes per week', SCHEMA_003_HINT)
  );

  el.body.appendChild(
    section(
      'Routine consistency, last 30 days',
      rates.length
        ? barList(
            rates.map((r) => ({ label: r.routine.name, value: r.rate, display: `${Math.round(r.rate * 100)}%` })),
            { max: 1 }
          )
        : 'No routines yet.'
    )
  );

  if (log.missing) {
    el.body.appendChild(section('Mood, energy and sleep', SCHEMA_003_HINT));
  } else {
    el.body.append(
      trendSection('Mood, last 30 days', log.data, 'mood', today, { max: 5 }),
      trendSection('Energy, last 30 days', log.data, 'energy', today, { max: 5 }),
      trendSection('Sleep, last 30 days', log.data, 'sleep', today, { unit: ' h' })
    );
  }
}

export async function initInsights() {
  el.body = document.getElementById('insights-body');
}

export async function refreshInsights() {
  try {
    await render();
  } catch (err) {
    showError(err);
  }
}
