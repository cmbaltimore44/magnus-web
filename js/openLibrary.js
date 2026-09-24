// Copy of Magnus's src/lib/openlibrary.js — keep the two in sync.
// Open Library lookups for adding books: by ISBN, or a title/author search.
// No API key needed. Returns plain book fields ready for the book form.
// The Life Tracker web app has a copy (js/openLibrary.js) — keep in sync.

const BASE = 'https://openlibrary.org';

export function normalizeIsbn(text) {
  const s = String(text || '').replace(/[\s-]/g, '').toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(s) ? s : null;
}

function coverUrl(coverId, isbn) {
  if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  if (isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  return null;
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
  return res.json();
}

// Returns up to `limit` candidates: { title, author, isbn, cover_image_url, year }.
export async function lookupBooks(query, { fetchImpl = fetch, limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const isbn = normalizeIsbn(q);
  const fields = 'title,author_name,isbn,cover_i,first_publish_year';
  const search = isbn ? `isbn=${isbn}` : `q=${encodeURIComponent(q)}`;
  const data = await getJson(fetchImpl, `${BASE}/search.json?${search}&limit=${limit}&fields=${fields}`);
  return (data.docs || []).map((d) => {
    const isbn13 = isbn || (d.isbn || []).find((i) => i.length === 13) || (d.isbn || [])[0] || null;
    return {
      title: d.title,
      author: (d.author_name || []).slice(0, 2).join(', ') || null,
      isbn: isbn13,
      cover_image_url: coverUrl(d.cover_i, isbn),
      year: d.first_publish_year ? String(d.first_publish_year) : null,
    };
  });
}

// ---------- one clear match (background enrichment after a quick add) ----------

export function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .split(':')[0]
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The candidate that surely is the book you meant, or null if it's unclear:
// - the title must match (ignoring case, punctuation, subtitles and a
//   leading "The/A/An");
// - if you gave an author, their surname must appear;
// - the matches must be one work: the top result's main author wrote at
//   least two thirds of them (editions of the same book count together;
//   a stray study guide or an unattributed edition doesn't block it).
const primaryAuthor = (c) => String(c.author || '').split(',')[0].trim().toLowerCase();
export function clearMatch({ title, author }, candidates) {
  const want = normalizeTitle(title);
  if (!want) return null;
  let hits = candidates.filter((c) => normalizeTitle(c.title) === want && c.author);
  if (author) {
    const surname = author.trim().split(/\s+/).pop().toLowerCase();
    hits = hits.filter((c) => String(c.author).toLowerCase().includes(surname));
  }
  if (!hits.length) return null;
  const lead = primaryAuthor(hits[0]);
  const same = hits.filter((c) => primaryAuthor(c) === lead);
  if (same.length * 3 < hits.length * 2) return null;
  const pick = same.find((c) => c.cover_image_url) || same[0];
  return { ...pick, author: pick.author.split(',')[0].trim() };
}

// Fields to fill on a quick-added book from a match: only what's missing.
export function enrichmentFields(book, match) {
  const out = {};
  if (!book.author && match.author) out.author = match.author;
  if (!book.cover_image_url && match.cover_image_url) out.cover_image_url = match.cover_image_url;
  if (!book.isbn && match.isbn) out.isbn = match.isbn;
  return out;
}
