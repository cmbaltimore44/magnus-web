import { supabase } from '../supabaseClient.js';
import { fetchAll } from './paging.js';
import { nextDue } from '../repeat.js';

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

// schema_008: marking a repeating task done makes the database insert its
// next copy and take the rule off the finished one, in one transaction, so
// the copy's created_at equals the original's completed_at. These find that
// copy and take a finish back (undo, or moving the task out of Done).
// Only an untouched copy counts: one you've since edited, started, starred or
// moved is a task of its own and stays.
export async function findSpawnedCopy(task) {
  if (!task?.completed_at || task.repeat) return null;
  const at = Date.parse(task.completed_at);
  const open = await listOpenTasks();
  return (
    open.find(
      (t) =>
        t.id !== task.id &&
        t.repeat &&
        Math.abs(Date.parse(t.created_at) - at) < 250 && // same transaction (the demo client is a few ms apart)
        t.status === 'todo' &&
        !t.is_starred &&
        t.title === task.title &&
        (t.notes ?? null) === (task.notes ?? null) &&
        (t.category_id ?? null) === (task.category_id ?? null) &&
        t.priority === task.priority &&
        (!task.due_date || t.due_date === nextDue(t.repeat, task.due_date))
    ) || null
  );
}

/** Update a done task back to `fields`, removing its untouched next copy and restoring its rule. → { row, removedId } */
export async function reopenTask(task, fields) {
  const copy = await findSpawnedCopy(task);
  if (!copy) return { row: await updateTask(task.id, fields), removedId: null };
  // The original first: if deleting the copy then fails, you have a duplicate, not a lost series.
  const row = await updateTask(task.id, { repeat: copy.repeat, ...fields });
  await deleteTask(copy.id);
  return { row, removedId: copy.id };
}
