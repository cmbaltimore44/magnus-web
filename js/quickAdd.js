// Copy of Magnus's src/lib/quickadd.js — keep the two in sync.
import { parseDateInput } from './dates.js';

// Quick add: one line → a new task.
//   "renew passport fri !high #home *"
//     due date   today, tomorrow/tom, weekday names, +3 / +3d, 2026-10-01, 10/1
//     !high      priority (!h / !m / !l also work)
//     #home      category whose name starts with "home" (case-insensitive)
//     *          starred
//   "> some thought" goes to the journal inbox instead (Magnus only).
//   "book: Piranesi by Susanna Clarke" (or "b: …") adds a Want to Read book;
//   "book: 978-0141439549" adds one by ISBN (looked up on Open Library).
//   "+groceries oat milk" adds "oat milk" to the list whose name starts with
//   "groceries" (Lists, schema_004); an unknown list name is reported, not guessed.
// Words that look like tokens but don't resolve (an unknown #tag, a date
// word that isn't a date) stay in the title, so nothing is silently lost.
// The Magnus Web app has a copy of this file (js/quickAdd.js); keep
// the two in sync.

const PRIORITY = { h: 'high', high: 'high', m: 'medium', med: 'medium', medium: 'medium', l: 'low', low: 'low' };
const DATE_WORD = /^(today|tod|tomorrow|tom|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[+]\d{1,3}d?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})$/i;

export function parseQuickAdd(text, categories = [], now = new Date()) {
  const raw = String(text || '').trim();
  if (raw.startsWith('>')) return { inbox: raw.slice(1).trim() };
  const book = /^(?:book|b):\s*(.*)$/i.exec(raw);
  if (book) return { book: parseBookText(book[1]) };
  // ("+3 call mom" is still a due date: list names start with a letter.)
  const toList = /^\+(?=$|\s|\p{L})(\S*)\s*(.*)$/u.exec(raw);
  if (toList) return { list: toList[1], text: toList[2].trim() };
  const out = { title: '', due_date: null, priority: 'medium', category_id: null, is_starred: false };
  const words = [];
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    if (word === '*') {
      out.is_starred = true;
      continue;
    }
    const pri = /^!(\w+)$/.exec(word);
    if (pri && PRIORITY[pri[1].toLowerCase()]) {
      out.priority = PRIORITY[pri[1].toLowerCase()];
      continue;
    }
    const cat = /^#(.+)$/.exec(word);
    if (cat) {
      const name = cat[1].toLowerCase();
      const match =
        categories.find((c) => c.name.toLowerCase() === name) ||
        categories.find((c) => c.name.toLowerCase().startsWith(name));
      if (match) {
        out.category_id = match.id;
        continue;
      }
    }
    if (!out.due_date && DATE_WORD.test(word)) {
      try {
        out.due_date = parseDateInput(word, now);
        continue;
      } catch {
        // not a real date — keep it in the title
      }
    }
    words.push(word);
  }
  out.title = words.join(' ');
  return out;
}

// "Title by Author" → { title, author }; an ISBN → { isbn }. The last " by "
// splits, so "Stand by Me by Stephen King" keeps its title.
export function parseBookText(text) {
  const t = String(text || '').trim();
  const isbn = t.replace(/[\s-]/g, '').toUpperCase();
  if (/^(\d{9}[\dX]|\d{13})$/.test(isbn)) return { isbn };
  const at = t.toLowerCase().lastIndexOf(' by ');
  if (at > 0) return { title: t.slice(0, at).trim(), author: t.slice(at + 4).trim() || null };
  return { title: t, author: null };
}

// The list a "+name" quick add points at: exact name first, then prefix.
export function findList(lists, name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  return lists.find((l) => l.name.toLowerCase() === n) || lists.find((l) => l.name.toLowerCase().startsWith(n)) || null;
}

// One-line description of what a parse will create, for the preview line.
export function describeQuickAdd(parsed, categories = [], lists = []) {
  if (parsed.inbox != null) return parsed.inbox ? `→ journal inbox: ${parsed.inbox}` : '→ journal inbox';
  if (parsed.book) {
    const b = parsed.book;
    if (b.isbn) return `→ Want to Read: ISBN ${b.isbn} (looked up on Open Library)`;
    if (!b.title) return 'book: Title by Author, or an ISBN → Want to Read';
    return `→ Want to Read: ${b.title}${b.author ? ` — ${b.author}` : ''}`;
  }
  if (parsed.list != null) {
    const list = findList(lists, parsed.list);
    if (!parsed.list) return '+list item → a list (e.g. +groceries oat milk)';
    return list ? `→ ${list.name}${parsed.text ? `: ${parsed.text}` : ''}` : `no list named “${parsed.list}”`;
  }
  const bits = [];
  if (parsed.due_date) bits.push(`due ${parsed.due_date}`);
  if (parsed.priority !== 'medium') bits.push(`${parsed.priority} priority`);
  const cat = categories.find((c) => c.id === parsed.category_id);
  if (cat) bits.push(cat.name);
  if (parsed.is_starred) bits.push('starred');
  return bits.join(' · ');
}
