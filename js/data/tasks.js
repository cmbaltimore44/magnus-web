import { supabase } from '../supabaseClient.js';
import { fetchAll } from './paging.js';

// Every task, in pages (finished tasks stay in the table, so it keeps growing).
export async function listTasks() {
  return fetchAll(() => supabase.from('tasks').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }));
}

// Only tasks that aren't done: for views that only show open tasks and are
// refreshed often (on focus, on every live update), so they don't download
// the whole history each time.
export async function listOpenTasks() {
  return fetchAll(() =>
    supabase.from('tasks').select('*').neq('status', 'done').order('sort_order', { ascending: true }).order('id', { ascending: true })
  );
}

export async function createTask(userId, fields, sortOrder) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ user_id: userId, sort_order: sortOrder, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, fields) {
  const { data, error } = await supabase
    .from('tasks')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}
