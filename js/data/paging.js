// Mirrors magnus/src/lib/data/paging.js.
//
// Supabase returns at most 1,000 rows per request (the project's "max rows"
// setting) and silently drops the rest, so any table that can grow past that
// is read page by page.
//
// `build` returns a fresh query for each page (a query can only run once).
// Its order must be total (end with a unique column, e.g. id) so rows can't
// shift between pages. Rows are de-duplicated by `key`, in case a row shows
// up in two pages (offline, pages can come from saved reads of different ages).
export const PAGE_SIZE = 1000;

export async function fetchAll(build, { key = (r) => r.id, pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  const seen = new Set();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    for (const r of data) {
      const k = key(r);
      if (k != null) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      rows.push(r);
    }
    if (data.length < pageSize) return rows;
  }
}
