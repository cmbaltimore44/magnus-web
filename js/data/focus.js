import { supabase } from '../supabaseClient.js';

// focus_sessions (schema_003): one row per focus-timer run.

export async function listFocusSessions(sinceISO) {
  let query = supabase.from('focus_sessions').select('*').order('started_at', { ascending: true });
  if (sinceISO) query = query.gte('started_at', sinceISO);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createFocusSession(userId, { task_id, started_at, minutes }) {
  const { data, error } = await supabase
    .from('focus_sessions')
    .insert({ user_id: userId, task_id, started_at, minutes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function focusMinutesForTask(taskId) {
  const { data, error } = await supabase.from('focus_sessions').select('minutes').eq('task_id', taskId);
  if (error) throw error;
  return data.reduce((sum, row) => sum + row.minutes, 0);
}
