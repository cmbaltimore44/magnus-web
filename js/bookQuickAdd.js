// Copy of Magnus's src/lib/bookQuickAdd.js — keep the two in sync.
// (Adapted imports: the web app renders text with textContent only, so
// Magnus's cleanDeep, which strips terminal escapes, is a no-op here.)
// Fast "Want to Read" adds (quick add `book: …`, the Want to Read tab):
// the book is saved straight away, then filled in from Open Library in the
// background when there's one clear match (lib/openlibrary.js clearMatch).
// An ISBN is looked up first, since it says nothing on its own.
// The Life Tracker web app has a copy (js/bookQuickAdd.js) — keep in sync.
import * as booksApi from './data/books.js';
import { lookupBooks, clearMatch, enrichmentFields } from './openLibrary.js';
const cleanDeep = (value) => value;

// Books still missing an author or a cover show a "?" in Want to Read.
export function needsDetails(book) {
  return !book.author || !book.cover_image_url;
}

export function nextWantOrder(books) {
  return books.filter((b) => b.status === 'want_to_read').reduce((m, b) => Math.max(m, (b.sort_order ?? 0) + 1), 0);
}

// Returns { book, enriched } where `enriched` resolves to the updated book
// (or null when there was nothing clear to fill in).
export async function addWantToRead(userId, { title, author, isbn }, books, { lookup = lookupBooks } = {}) {
  const sortOrder = nextWantOrder(books);
  const base = { status: 'want_to_read', format: 'none' };
  if (isbn) {
    let found = null;
    try {
      found = cleanDeep(await lookup(isbn))[0] || null;
    } catch {
      // offline or Open Library down: save the ISBN, resolve later
    }
    const fields = found
      ? { ...base, title: found.title, author: found.author, isbn, cover_image_url: found.cover_image_url }
      : { ...base, title: `ISBN ${isbn}`, isbn };
    return { book: await booksApi.createBook(userId, fields, sortOrder), enriched: Promise.resolve(null) };
  }
  const book = await booksApi.createBook(userId, { ...base, title, author: author || null }, sortOrder);
  const enriched = (async () => {
    try {
      const match = clearMatch({ title, author }, cleanDeep(await lookup([title, author].filter(Boolean).join(' '))));
      const fields = match ? enrichmentFields(book, match) : {};
      return Object.keys(fields).length ? await booksApi.updateBook(book.id, fields) : null;
    } catch {
      return null; // the "?" stays; `i` on the book resolves it by hand
    }
  })();
  return { book, enriched };
}
