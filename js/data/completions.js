import { supabase } from '../supabaseClient.js';
import { fetchAll } from './paging.js';

export function todayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateISO, delta) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

// Check-offs are loaded for a window of recent days, not all of history:
// the longest look-back anything shows is the routines heatmap (53 weeks).
// A streak that runs into the window's edge gets its routine's older
// check-offs fetched, a window at a time, until the streak ends, so streaks
// are always exact. Same as Magnus's src/lib/data/completions.js.
export const COMPLETIONS_WINDOW_DAYS = 400;

const byDateKey = (r) => `${r.routine_id} ${r.completed_date}`;

// routine id → Set of 'YYYY-MM-DD'.
// since: first day to load (default: the window); extendStreaks: false for
// callers that don't show streaks (Insights' last 30 days).
export async function listCompletions({ since, extendStreaks = true, today = todayISO() } = {}) {
  const from = since ?? addDays(today, -(COMPLETIONS_WINDOW_DAYS - 1));
  const rows = await fetchAll(
    () =>
      supabase
        .from('routine_completions')
        .select('routine_id, completed_date')
        .gte('completed_date', from)
        .order('completed_date', { ascending: true })
        .order('routine_id', { ascending: true }),
    { key: byDateKey }
  );

  const byRoutine = new Map();
  for (const row of rows) {
    if (!byRoutine.has(row.routine_id)) byRoutine.set(row.routine_id, new Set());
    byRoutine.get(row.routine_id).add(row.completed_date);
  }
  if (extendStreaks) {
    for (const [routineId, dates] of byRoutine) await extendStreak(routineId, dates, from, today);
  }
  return byRoutine;
}

// First day of the routine's current streak (same grace rule as
// computeStreak), or null when there's no streak.
export function streakStart(completedDateSet, todayDateISO) {
  let cursor = todayDateISO;
  if (!completedDateSet.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!completedDateSet.has(cursor)) return null;
  }
  while (completedDateSet.has(addDays(cursor, -1))) cursor = addDays(cursor, -1);
  return cursor;
}

// While the streak starts exactly at the edge of what's loaded, it may go
// further back: load the previous window for this routine and look again.
async function extendStreak(routineId, dates, loadedFrom, today) {
  let edge = loadedFrom;
  while (streakStart(dates, today) === edge) {
    const before = addDays(edge, -COMPLETIONS_WINDOW_DAYS);
    const older = await fetchAll(
      () =>
        supabase
          .from('routine_completions')
          .select('routine_id, completed_date')
          .eq('routine_id', routineId)
          .gte('completed_date', before)
          .lt('completed_date', edge)
          .order('completed_date', { ascending: true }),
      { key: byDateKey }
    );
    for (const row of older) dates.add(row.completed_date);
    if (!older.length) return;
    edge = before;
  }
}

export async function markComplete(userId, routineId, dateISO) {
  const { error } = await supabase
    .from('routine_completions')
    .insert({ user_id: userId, routine_id: routineId, completed_date: dateISO });
  if (error) throw error;
}

export async function markIncomplete(routineId, dateISO) {
  const { error } = await supabase
    .from('routine_completions')
    .delete()
    .eq('routine_id', routineId)
    .eq('completed_date', dateISO);
  if (error) throw error;
}

export function countsByDate(completions) {
  const counts = new Map();
  for (const dates of completions.values()) {
    for (const d of dates) {
      counts.set(d, (counts.get(d) || 0) + 1);
    }
  }
  return counts;
}

// Grace-period streak: a routine not yet checked off today still shows
// yesterday's streak, so it doesn't look reset before the day is over.
export function computeStreak(completedDateSet, todayDateISO) {
  let cursor = todayDateISO;
  if (!completedDateSet.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!completedDateSet.has(cursor)) return 0;
  }
  let streak = 0;
  while (completedDateSet.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
