// Offline mode (read-only).
//
// makeOfflineFetch wraps the Supabase client's fetch: every successful REST
// read (GET /rest/v1/…) is saved in localStorage, keyed by the signed-in
// user and the request, and replayed when the network is unreachable, which
// also flags the app as offline. A read that was never saved (the next page
// of a big table, a date window that has moved on since yesterday, one
// random quote) is answered from the saved rows of its table instead
// (answerFromCache). Writes while offline fail fast with a clear
// "you're offline" error instead of an obscure network failure.
// Sign-out clears the saved data (clearOfflineCache). When storage is full,
// the reads saved longest ago make room for new ones.

const PREFIX = 'kanban.offline.';

let userId = null;
let offline = false;
const listeners = [];

export function setOfflineUser(uid) {
  userId = uid;
}

export function isOffline() {
  return offline;
}

// Called by the fetch wrapper, and by app.js on the browser's online/offline events.
export function reportNetworkState(isNowOffline) {
  if (offline === isNowOffline) return;
  offline = isNowOffline;
  listeners.forEach((fn) => fn(offline));
}

export function onOfflineChange(fn) {
  listeners.push(fn);
}

export class OfflineError extends Error {
  constructor() {
    super("You're offline — changes are disabled until you reconnect.");
    this.name = 'Offline';
    this.code = 'OFFLINE';
  }
}

export function isOfflineError(err) {
  return !!err && (err.code === 'OFFLINE' || err instanceof OfflineError);
}

export function clearOfflineCache(storage = globalThis.localStorage) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // storage unavailable
  }
}

// ---------- answering a new read from saved ones ----------
// A tiny PostgREST query evaluator over saved rows, same as Magnus's
// src/lib/offline.js (parseQuery, rowMatches, answerFromCache).

const OBJECT = 'application/vnd.pgrst.object+json';

function parseValue(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function parseQuery(url) {
  const u = new URL(url);
  const table = u.pathname.split('/rest/v1/')[1]?.split('/')[0];
  const filters = [];
  let order = [];
  let select = '*';
  for (const [key, raw] of u.searchParams) {
    if (key === 'select') select = raw;
    else if (key === 'order') order = raw.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, desc: dir === 'desc' }; });
    else if (['limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    else {
      const m = /^(eq|neq|gte|lte|gt|lt|in|is)\.(.*)$/.exec(raw);
      if (m) filters.push({ col: key, op: m[1], value: m[2] });
    }
  }
  return { table, filters, order, select };
}

function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function rowMatches(row, filters) {
  return filters.every(({ col, op, value }) => {
    const v = row[col];
    if (op === 'in') return value.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).map(parseValue).map(String).includes(String(v));
    const want = parseValue(value);
    if (op === 'is') return v === want;
    if (op === 'eq') return String(v) === String(want);
    if (op === 'neq') return String(v) !== String(want);
    const c = cmp(v, typeof v === 'number' ? Number(want) : want);
    return v != null && (op === 'gte' ? c >= 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c < 0);
  });
}

const columns = (select) => (select === '*' ? null : select.split(',').map((c) => c.trim()));

// A saved read can stand in only if it has every column asked for, so a
// slim read (e.g. the phone bar's counts) never passes for full rows.
function covers(saved, wanted) {
  if (saved === wanted) return true;
  if (/[()]/.test(saved) || /[()]/.test(wanted)) return false; // embedded tables: exact match only
  const have = columns(saved);
  const want = columns(wanted);
  return !have || (!!want && want.every((c) => have.includes(c)));
}

function project(row, select) {
  const want = columns(select);
  if (!want) return { ...row };
  const out = {};
  for (const c of want) if (c in row) out[c] = row[c];
  return out;
}

// saved: [{ url, accept, body, at }] (body parsed). Answers `url` from every
// saved row of the same table, filtered, ordered and paged the way the
// server would, newer saves winning over older ones. Best effort, like the
// rest of offline mode; null when nothing saved can answer it.
export function answerFromCache(saved, url) {
  const q = parseQuery(url);
  const rows = new Map();
  let known = false;
  for (const entry of [...saved].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const sq = parseQuery(entry.url);
    if (sq.table !== q.table || !covers(sq.select, q.select)) continue;
    known = true;
    const list = Array.isArray(entry.body) ? entry.body : entry.body ? [entry.body] : [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const k = r.id ?? JSON.stringify(r);
      rows.set(k, { ...rows.get(k), ...r });
    }
  }
  if (!known) return null;
  let out = [...rows.values()].filter((r) => rowMatches(r, q.filters));
  for (const { col, desc } of [...q.order].reverse()) out.sort((a, b) => (desc ? -1 : 1) * cmp(a[col], b[col]));
  const params = new URL(url).searchParams;
  const offset = Number(params.get('offset') || 0);
  const limit = params.get('limit');
  out = out.slice(offset, limit == null ? undefined : offset + Number(limit));
  return out.map((r) => project(r, q.select));
}

// ---------- the fetch wrapper ----------

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

// fetch() rejects (TypeError) when the network is unreachable; an abort isn't that.
function isNetworkFailure(err) {
  return !!err && err.name !== 'AbortError';
}

export function makeOfflineFetch(
  baseFetch = (...args) => fetch(...args),
  { storage = globalThis.localStorage, isBrowserOnline = () => globalThis.navigator?.onLine !== false } = {}
) {
  const cacheKey = (url, init) => {
    if (!userId) return null;
    // .single() asks for a different representation of the same URL.
    const accept = headerValue(init && init.headers, 'Accept') || '';
    return `${PREFIX}${userId}|${accept}|${url}`;
  };

  // Saved reads of every user, oldest first (for making room).
  const savedKeysOldestFirst = (except) => {
    const found = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(PREFIX) || key === except) continue;
      let at = 0;
      try {
        at = JSON.parse(storage.getItem(key)).at || 0;
      } catch {
        // unreadable: oldest
      }
      found.push({ key, at });
    }
    return found.sort((a, b) => a.at - b.at).map((e) => e.key);
  };

  const save = async (key, res) => {
    try {
      const body = await res.text();
      const headers = {};
      ['content-type', 'content-range'].forEach((h) => {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      });
      const value = JSON.stringify({ body, headers, status: res.status, at: Date.now() });
      try {
        storage.setItem(key, value);
      } catch {
        // Storage full (reads whose URL has moved on, like yesterday's date
        // window, pile up): drop the oldest saved reads until this one fits.
        for (const old of savedKeysOldestFirst(key)) {
          storage.removeItem(old);
          try {
            storage.setItem(key, value);
            return;
          } catch {
            // still full
          }
        }
      }
    } catch {
      // storage unavailable: this read just won't be available offline
    }
  };

  // Everything saved for this user about the table `url` reads, for
  // answerFromCache.
  const savedReads = (url) => {
    const prefix = `${PREFIX}${userId}|`;
    const table = parseQuery(url).table;
    const out = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const bar = rest.indexOf('|');
        const entryUrl = rest.slice(bar + 1);
        if (parseQuery(entryUrl).table !== table) continue;
        const entry = load(key);
        if (!entry || (entry.status && entry.status >= 300)) continue;
        try {
          out.push({ url: entryUrl, accept: rest.slice(0, bar), body: JSON.parse(entry.body), at: entry.at || 0 });
        } catch {
          // not JSON: skip
        }
      }
    } catch {
      // storage unavailable
    }
    return out;
  };

  // A never-saved read, answered from saved rows (see answerFromCache);
  // null when that's not possible.
  const answer = (url, init) => {
    if (!userId) return null;
    const rows = answerFromCache(savedReads(url), url);
    if (!rows) return null;
    const accept = headerValue(init && init.headers, 'Accept') || '';
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    const range = rows.length ? `${offset}-${offset + rows.length - 1}/*` : '*/*';
    if (accept === OBJECT) {
      if (rows.length !== 1) return null; // .single(): exactly one row, or no answer
      return new Response(JSON.stringify(rows[0]), { status: 200, headers: { 'content-type': OBJECT, 'content-range': range } });
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json', 'content-range': range } });
  };

  const load = (key) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  return async function offlineFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/rest\/v1\//.test(url)) return baseFetch(input, init); // auth, storage, …
    const method = String((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();

    if (method !== 'GET' && method !== 'HEAD') {
      if (!isBrowserOnline()) {
        reportNetworkState(true);
        throw new OfflineError();
      }
      try {
        const res = await baseFetch(input, init);
        reportNetworkState(false);
        return res;
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        reportNetworkState(true);
        throw new OfflineError();
      }
    }

    const key = method === 'GET' ? cacheKey(url, init) : null;
    try {
      const res = await baseFetch(input, init);
      reportNetworkState(false);
      if (key && res.ok) await save(key, res.clone());
      return res;
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      reportNetworkState(true);
      const cached = key && load(key);
      if (cached) return new Response(cached.body, { status: cached.status || 200, headers: cached.headers });
      const answered = key && answer(url, init);
      if (!answered) throw err;
      return answered;
    }
  };
}

// Offline, an expired access token can't be refreshed, and supabase-js
// would keep retrying the refresh (for up to ~30 s per request) and then
// report no session — showing the sign-in screen instead of saved data.
// While the browser says it's offline, answer getSession from the session
// supabase-js stored on this device instead.
export function useStoredSessionWhenOffline(supabase, storageKey, {
  storage = globalThis.localStorage,
  isBrowserOnline = () => globalThis.navigator?.onLine !== false,
} = {}) {
  const getSession = supabase.auth.getSession.bind(supabase.auth);
  supabase.auth.getSession = async () => {
    if (isBrowserOnline()) return getSession();
    reportNetworkState(true);
    try {
      const raw = JSON.parse(storage.getItem(storageKey) || 'null');
      const session = raw && raw.access_token ? raw : raw?.currentSession || null;
      if (session && session.user) return { data: { session }, error: null };
    } catch {
      // fall through to the normal path
    }
    return getSession();
  };
}
