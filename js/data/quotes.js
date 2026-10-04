import { supabase } from '../supabaseClient.js';
import { fetchAll } from './paging.js';

export async function listQuotes() {
  return fetchAll(() => supabase.from('quotes').select('*').order('created_at', { ascending: false }).order('id', { ascending: true }));
}

export async function listQuotesForBook(bookId) {
  return fetchAll(() =>
    supabase.from('quotes').select('*').eq('book_id', bookId).order('created_at', { ascending: false }).order('id', { ascending: true })
  );
}

export async function createQuote(userId, fields, sortOrder) {
  const { data, error } = await supabase
    .from('quotes')
    .insert({ user_id: userId, sort_order: sortOrder, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuote(id, fields) {
  const { data, error } = await supabase
    .from('quotes')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteQuote(id) {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw error;
}

// One random quote without downloading them all: count them, then fetch
// just the one at a random position. If the count isn't available (e.g.
// offline, where only plain reads are saved), pick from the full list.
const QUOTE_COLS = 'id, quote_text, attribution, book_id';
export async function pickRandomQuote() {
  const { count, error } = await supabase.from('quotes').select('id', { count: 'exact', head: true });
  if (!error && typeof count === 'number') {
    if (!count) return null;
    const at = Math.floor(Math.random() * count);
    const res = await supabase.from('quotes').select(QUOTE_COLS).order('id', { ascending: true }).range(at, at);
    if (!res.error && res.data?.length) return res.data[0];
  }
  const all = await fetchAll(() => supabase.from('quotes').select(QUOTE_COLS).order('id', { ascending: true }));
  return all.length ? all[Math.floor(Math.random() * all.length)] : null;
}

// Composes the display attribution from the book's *current* title rather
// than baking a title snapshot into the stored value, so renaming a book
// can never desync it from quotes that reference it.
export function formatAttribution(quote, books) {
  const raw = quote.attribution || '';
  if (!quote.book_id) return raw;
  const book = books.find((b) => b.id === quote.book_id);
  if (!book) return raw;
  return raw ? `${book.title} - ${raw}` : book.title;
}
