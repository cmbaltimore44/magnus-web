// Retries Supabase's "JWT issued at future" error (PostgREST PGRST303, 401).
//
// Right after the app refreshes an expired session (typically when you open
// it after a break) it uses the brand-new access token within milliseconds.
// That token's `iat` comes from Supabase Auth's clock but is checked by the
// data API's clock; if that one is a fraction of a second behind, the token
// looks like it was issued in the future and the request is rejected.
//
// The request is refused before anything runs, so it's safe to retry (even
// for writes): wait until just past the token's `iat`, capped at a few
// seconds, and try again. Same fix as Magnus's src/lib/fetch.js.

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export function tokenIssuedAt(init) {
  const auth = headerValue(init && init.headers, 'Authorization');
  const match = auth && /^Bearer\s+(.+)$/i.exec(auth);
  const payload = match && match[1].split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims.iat === 'number' ? claims.iat : null;
  } catch {
    return null;
  }
}

async function isIssuedInFuture(res) {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body && body.code === 'PGRST303' && /issued at future/i.test(String(body.message));
  } catch {
    return false;
  }
}

export function makeResilientFetch(baseFetch = (...args) => fetch(...args), { now = () => Date.now(), wait = sleep } = {}) {
  return async function resilientFetch(input, init) {
    let res = await baseFetch(input, init);
    for (let attempt = 1; attempt <= MAX_RETRIES && (await isIssuedInFuture(res)); attempt++) {
      const iat = tokenIssuedAt(init);
      const untilIat = iat ? iat * 1000 - now() : 0;
      await wait(Math.min(MAX_WAIT_MS, Math.max(500 * attempt, untilIat + 500)));
      res = await baseFetch(input, init);
    }
    return res;
  };
}

export const resilientFetch = makeResilientFetch();
