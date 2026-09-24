import { supabase } from '../supabaseClient.js';

// log_entries (schema_003): the daily Log. sleep / weight / mood / energy are
// one per day (setDailyMetric updates that day's row); workouts can repeat
// (value = minutes, note = type).

export const DAILY_METRICS = ['sleep', 'weight', 'mood', 'energy'];

export async function listLogEntries(fromISO, toISO) {
  const { data, error } = await supabase
    .from('log_entries')
    .select('*')
    .gte('entry_date', fromISO)
    .lte('entry_date', toISO)
    .order('entry_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

// value null clears the day's entry.
export async function setDailyMetric(userId, dateISO, metric, value) {
  const { data: existing, error } = await supabase
    .from('log_entries')
    .select('id')
    .eq('entry_date', dateISO)
    .eq('metric', metric)
    .order('created_at', { ascending: true });
  if (error) throw error;

  if (value == null) {
    if (!existing.length) return;
    const { error: delError } = await supabase.from('log_entries').delete().in('id', existing.map((r) => r.id));
    if (delError) throw delError;
    return;
  }
  if (existing.length) {
    const { error: upError } = await supabase.from('log_entries').update({ value }).eq('id', existing[0].id);
    if (upError) throw upError;
    return;
  }
  const { error: insError } = await supabase
    .from('log_entries')
    .insert({ user_id: userId, entry_date: dateISO, metric, value });
  if (insError) throw insError;
}

export async function addWorkout(userId, dateISO, minutes, type) {
  const { data, error } = await supabase
    .from('log_entries')
    .insert({ user_id: userId, entry_date: dateISO, metric: 'workout', value: minutes, note: type || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLogEntry(id) {
  const { error } = await supabase.from('log_entries').delete().eq('id', id);
  if (error) throw error;
}
