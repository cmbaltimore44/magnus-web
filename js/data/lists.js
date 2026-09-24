import { supabase } from '../supabaseClient.js';

// lists / list_items (schema_004): groceries, wish list, packing… Each item
// has text, done, and an optional url and price. Mirrors Magnus's
// src/lib/data/lists.js.

export async function listLists() {
  const { data, error } = await supabase.from('lists').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listAllItems() {
  const { data, error } = await supabase.from('list_items').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createList(userId, name, sortOrder) {
  const { data, error } = await supabase
    .from('lists')
    .insert({ user_id: userId, name, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameList(id, name) {
  const { data, error } = await supabase.from('lists').update({ name }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteList(id) {
  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) throw error;
}

// table: 'lists' or 'list_items'.
export async function reorder(table, orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from(table).update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export async function createItem(userId, listId, text, sortOrder) {
  const { data, error } = await supabase
    .from('list_items')
    .insert({ user_id: userId, list_id: listId, text, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Adds to the end of a list (quick add "+list text").
export async function appendItem(userId, listId, text) {
  const { data, error } = await supabase.from('list_items').select('sort_order').eq('list_id', listId);
  if (error) throw error;
  const next = data.reduce((m, i) => Math.max(m, i.sort_order + 1), 0);
  return createItem(userId, listId, text, next);
}

export async function updateItem(id, fields) {
  const { data, error } = await supabase.from('list_items').update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteItems(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from('list_items').delete().in('id', ids);
  if (error) throw error;
}

// Only http(s) links are kept; "example.com/x" gets https:// added.
// Returns null for an empty value and throws for anything else.
export function cleanUrl(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    return u.toString();
  } catch {
    throw new Error('Link must be an http(s) URL.');
  }
}

// For display: the url if it's http(s), else null (rows can come from other clients).
export function safeUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

// "24.99", "$24.99", "1,200" → number; "" → null; anything else throws.
export function parsePrice(text) {
  const s = String(text ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error('Price should be a number, e.g. 24.99.');
  return Math.round(n * 100) / 100;
}

export const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
