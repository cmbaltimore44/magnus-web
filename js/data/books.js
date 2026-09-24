import { supabase } from '../supabaseClient.js';

export async function listBooks() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getBook(id) {
  const { data, error } = await supabase.from('books').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createBook(userId, fields, sortOrder) {
  const { data, error } = await supabase
    .from('books')
    .insert({ user_id: userId, sort_order: sortOrder, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBook(id, fields) {
  const { data, error } = await supabase
    .from('books')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBook(id) {
  const { error } = await supabase.from('books').delete().eq('id', id);
  if (error) throw error;
}

// Want to Read order: changes is [{ id, sort_order }] (only the rows that moved).
export async function setSortOrders(changes) {
  const results = await Promise.all(
    changes.map(({ id, sort_order }) => supabase.from('books').update({ sort_order }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}
