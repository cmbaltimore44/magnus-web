import { supabase } from '../supabaseClient.js';

// assistant_days (schema_007): one row per day. closed_at set = the day is
// closed, so the evening "Close the day?" push doesn't come. Magnus sets it
// from `today --close` (magnus day close); Today's "Done for today" here.

export async function isDayClosed(dayISO) {
  const { data, error } = await supabase.from('assistant_days').select('closed_at').eq('day', dayISO).maybeSingle();
  if (error) throw error;
  return Boolean(data?.closed_at);
}

export async function setDayClosed(userId, dayISO, closed) {
  const { error } = await supabase
    .from('assistant_days')
    .upsert({ user_id: userId, day: dayISO, closed_at: closed ? new Date().toISOString() : null });
  if (error) throw error;
}
