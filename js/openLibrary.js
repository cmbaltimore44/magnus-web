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
