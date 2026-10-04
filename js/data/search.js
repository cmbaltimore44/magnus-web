import { supabase } from '../supabaseClient.js';
import { fetchAll } from './paging.js';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function fetchSearchIndex() {
  const [tasks, projects, books, quotes, routines] = await Promise.all([
    // Tables that can pass Supabase's 1,000-rows-per-request cap are paged.
    fetchAll(() => supabase.from('tasks').select('id, title, notes').order('id', { ascending: true })),
    supabase.from('projects').select('id, name, notes, status').then(unwrap),
    fetchAll(() => supabase.from('books').select('id, title, author, notes').order('id', { ascending: true })),
    fetchAll(() => supabase.from('quotes').select('id, quote_text, attribution, book_id').order('id', { ascending: true })),
    supabase.from('routines').select('id, name, time_of_day').then(unwrap),
  ]);
  return { tasks, projects, books, quotes, routines };
}
