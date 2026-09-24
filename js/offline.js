// Offline mode (read-only).
//
// makeOfflineFetch wraps the Supabase client's fetch: every successful REST
// read (GET /rest/v1/…) is saved in localStorage, keyed by the signed-in
// user and the request, and replayed when the network is unreachable, which
// also flags the app as offline. Writes while offline fail fast with a clear
// "you're offline" error instead of an obscure network failure.
// Sign-out clears the saved data (clearOfflineCache).

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

  const save = async (key, res) => {
    try {
      const body = await res.text();
      const headers = {};
      ['content-type', 'content-range'].forEach((h) => {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      });
      storage.setItem(key, JSON.stringify({ body, headers, status: res.status }));
    } catch {
      // storage full or unavailable: this read just won't be available offline
    }
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
      if (!cached) throw err;
      return new Response(cached.body, { status: cached.status || 200, headers: cached.headers });
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
