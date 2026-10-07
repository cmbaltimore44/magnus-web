// Copy of Magnus's src/lib/stats.js — keep the two in sync.
// Pure calculations behind Upcoming, Insights and Book stats. No I/O, so
// they're unit-tested directly; the Magnus Web app has a copy
// (js/stats.js) — keep the two in sync.
import { addDays, toISO } from './dates.js';

// ---------- Upcoming (7 days) ----------

export const UPCOMING_GROUPS = ['overdue', 'today', 'tomorrow', 'week'];
export const UPCOMING_LABELS = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', week: 'Next 7 days' };

// Open tasks with a due date and unfinished projects with a target date,
// from overdue through 7 days out. Items: { kind: 'task'|'project', date, item }.
export function groupUpcoming(tasks, projects, today) {
  const end = addDays(today, 7);
  const tomorrow = addDays(today, 1);
  const items = [
    ...tasks.filter((t) => t.due_date && t.status !== 'done').map((t) => ({ kind: 'task', date: t.due_date, item: t })),
    ...projects.filter((p) => p.target_date && p.status !== 'done').map((p) => ({ kind: 'project', date: p.target_date, item: p })),
  ].filter((x) => x.date <= end);
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'project' ? -1 : 1));
  const groups = Object.fromEntries(UPCOMING_GROUPS.map((g) => [g, []]));
  for (const x of items) {
    const g = x.date < today ? 'overdue' : x.date === today ? 'today' : x.date === tomorrow ? 'tomorrow' : 'week';
    groups[g].push(x);
  }
  return groups;
}

// ---------- weeks ----------

// Monday of the week containing dateISO.
export function weekStart(dateISO) {
  const d = new Date(dateISO + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  return addDays(dateISO, -dow);
}

// ISO week label, e.g. "2026-W39", for the week containing dateISO.
export function isoWeek(dateISO) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Thursday of this week
  const year = d.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Monday (ISO date) of an ISO week label like "2026-W39".
export function isoWeekMonday(label) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(label));
  if (!m) throw new Error(`"${label}" isn't a week (use YYYY-Www, e.g. 2026-W39)`);
  const jan4 = new Date(Number(m[1]), 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (Number(m[2]) - 1) * 7);
  return toISO(monday);
}

// Local calendar date of a timestamp.
export function localDate(timestamp) {
  return toISO(new Date(timestamp));
}

// ---------- Insights ----------

// Tasks finished per week for the last `weeks` weeks (oldest first).
// Only tasks with completed_at (set by the database since schema_003) count.
export function completedByWeek(tasks, today, weeks = 8) {
  const starts = Array.from({ length: weeks }, (_, i) => addDays(weekStart(today), -7 * (weeks - 1 - i)));
  const counts = starts.map(() => 0);
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const i = starts.indexOf(weekStart(localDate(t.completed_at)));
    if (i >= 0) counts[i]++;
  }
  return starts.map((start, i) => ({ start, count: counts[i] }));
}

// Focus minutes per week (oldest first).
export function focusByWeek(sessions, today, weeks = 8) {
  const starts = Array.from({ length: weeks }, (_, i) => addDays(weekStart(today), -7 * (weeks - 1 - i)));
  const mins = starts.map(() => 0);
  for (const s of sessions) {
    const i = starts.indexOf(weekStart(localDate(s.started_at)));
    if (i >= 0) mins[i] += s.minutes;
  }
  return starts.map((start, i) => ({ start, minutes: mins[i] }));
}

// Focus minutes in the last `days` days by what they were on: a task's
// title, a label, or "no task"; biggest first.
export function focusByWhat(sessions, tasks, today, days = 30) {
  const from = addDays(today, -(days - 1));
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const groups = new Map(); // labels group regardless of case, shown as last typed
  for (const s of [...sessions].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))) {
    const d = localDate(s.started_at);
    if (d < from || d > today) continue;
    const name = s.task_id ? titles.get(s.task_id) || 'a deleted task' : s.label?.trim() || 'no task';
    const key = s.task_id ? `task:${s.task_id}` : `label:${name.toLowerCase()}`;
    const g = groups.get(key) || { name, minutes: 0 };
    groups.set(key, { name, minutes: g.minutes + s.minutes });
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}

// Share of the last `days` days (ending today) each routine was done.
export function routineRates(routines, completions, today, days = 30) {
  const from = addDays(today, -(days - 1));
  return routines.map((r) => {
    const set = completions.get(r.id) || new Set();
    let done = 0;
    for (const d of set) if (d >= from && d <= today) done++;
    return { routine: r, done, days, rate: done / days };
  });
}

// Daily values of one Log metric over the last `days` days (oldest first);
// null where nothing was logged. Workouts sum their minutes per day.
export function metricSeries(entries, metric, today, days = 30) {
  const from = addDays(today, -(days - 1));
  const byDate = new Map();
  for (const e of entries) {
    if (e.metric !== metric || e.entry_date < from || e.entry_date > today) continue;
    const v = Number(e.value);
    byDate.set(e.entry_date, metric === 'workout' ? (byDate.get(e.entry_date) || 0) + v : v);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, value: byDate.has(date) ? byDate.get(date) : null };
  });
}

export function average(values) {
  const nums = values.filter((v) => v != null && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

const SPARKS = '▁▂▃▄▅▆▇█';

// Text sparkline; gaps (null) show as a space. Shared by Magnus and jweek.
export function sparkline(values, { min, max } = {}) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return ' '.repeat(values.length);
  const lo = min ?? Math.min(...nums);
  const hi = max ?? Math.max(...nums);
  return values
    .map((v) => {
      if (v == null) return ' ';
      if (hi === lo) return SPARKS[3];
      return SPARKS[Math.max(0, Math.min(7, Math.round(((v - lo) / (hi - lo)) * 7)))];
    })
    .join('');
}

// ---------- Book stats ----------

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

export function bookStats(books, today) {
  const year = today.slice(0, 4);
  const finished = books.filter((b) => b.status === 'finished');
  const rated = books.filter((b) => b.rating);
  const durations = finished
    .filter((b) => b.started_date && b.finished_date && b.finished_date >= b.started_date)
    .map((b) => daysBetween(b.started_date, b.finished_date));
  const byYear = new Map();
  for (const b of finished) {
    if (!b.finished_date) continue;
    const y = b.finished_date.slice(0, 4);
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  const byFormat = new Map();
  for (const b of finished) {
    const f = b.format && b.format !== 'none' ? b.format : 'unknown';
    byFormat.set(f, (byFormat.get(f) || 0) + 1);
  }
  const authors = new Map();
  for (const b of finished) if (b.author) authors.set(b.author, (authors.get(b.author) || 0) + 1);
  const ratingCounts = [1, 2, 3, 4, 5].map((n) => rated.filter((b) => b.rating === n).length);
  return {
    total: books.length,
    reading: books.filter((b) => b.status === 'reading').length,
    wantToRead: books.filter((b) => b.status === 'want_to_read').length,
    finished: finished.length,
    dnf: books.filter((b) => b.status === 'dnf').length,
    finishedThisYear: byYear.get(year) || 0,
    averageRating: rated.length ? rated.reduce((n, b) => n + b.rating, 0) / rated.length : null,
    ratingCounts,
    averageDays: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    byYear: [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])),
    byFormat: [...byFormat.entries()].sort((a, b) => b[1] - a[1]),
    topAuthors: [...authors.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
