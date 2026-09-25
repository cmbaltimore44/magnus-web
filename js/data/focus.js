import { supabase } from '../supabaseClient.js';

// focus_sessions (schema_003): one row per focus-timer run.

export async function listFocusSessions(sinceISO) {
  let query = supabase.from('focus_sessions').select('*').order('started_at', { ascending: true });
  if (sinceISO) query = query.gte('started_at', sinceISO);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// `label` (schema_005) names focus time that isn't a task. Before that
// migration the session is still saved, just without it: labelDropped says so.
export async function createFocusSession(userId, { task_id, started_at, minutes, label = null }) {
  const row = { user_id: userId, task_id, started_at, minutes };
  const insert = (r) => supabase.from('focus_sessions').insert(r).select().single();
  let { data, error } = await insert(label ? { ...row, label } : row);
  if (error && label && ['42703', 'PGRST204'].includes(error.code)) {
    ({ data, error } = await insert(row));
    if (!error) return { ...data, labelDropped: true };
  }
  if (error) throw error;
  return data;
}

// Labels used in recent sessions, most recent first (for the focus picker).
export function recentLabels(sessions, limit = 8) {
  const seen = new Map();
  for (const s of [...sessions].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))) {
    const key = s.label?.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, s.label.trim());
  }
  return [...seen.values()].slice(0, limit);
}

export async function focusMinutesForTask(taskId) {
  const { data, error } = await supabase.from('focus_sessions').select('minutes').eq('task_id', taskId);
  if (error) throw error;
  return data.reduce((sum, row) => sum + row.minutes, 0);
}
