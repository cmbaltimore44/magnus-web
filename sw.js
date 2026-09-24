// Service worker: lets the app open without a network connection.
//
// Network-first for the app shell (this site's files and the Supabase JS
// library from jsDelivr): online you always get the latest deploy, and each
// response refreshes the offline copy; offline, the saved copy is served.
// Supabase API traffic is never touched here — offline data is handled by
// js/offline.js. Bump VERSION to drop old caches (not needed for updates,
// which arrive through the network anyway).
const VERSION = 'v1';
const CACHE = `life-tracker-shell-${VERSION}`;

// Saved at install so even the first offline open works. Anything missing
// from this list is still cached the first time it's fetched online.
const SHELL = [
  './',
  'index.html',
  'style.css',
  'themes.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/auth.js',
  'js/bookQuickAdd.js',
  'js/charts.js',
  'js/commands.js',
  'js/data/books.js',
  'js/data/categories.js',
  'js/data/completions.js',
  'js/data/focus.js',
  'js/data/lists.js',
  'js/data/logs.js',
  'js/data/projects.js',
  'js/data/projectTasks.js',
  'js/data/quotes.js',
  'js/data/routines.js',
  'js/data/search.js',
  'js/data/tasks.js',
  'js/dates.js',
  'js/events.js',
  'js/focus.js',
  'js/hash.js',
  'js/live.js',
  'js/migrate.js',
  'js/offline.js',
  'js/openLibrary.js',
  'js/palettes.js',
  'js/quickAdd.js',
  'js/quickAddBar.js',
  'js/resilientFetch.js',
  'js/schema.js',
  'js/search.js',
  'js/settings.js',
  'js/stats.js',
  'js/supabaseClient.js',
  'js/sw-register.js',
  'js/taskDisplay.js',
  'js/theme-boot.js',
  'js/theme.js',
  'js/toast.js',
  'js/undo.js',
  'js/views/board.js',
  'js/views/insights.js',
  'js/views/library.js',
  'js/views/lists.js',
  'js/views/log.js',
  'js/views/projects.js',
  'js/views/routines.js',
  'js/views/settings.js',
  'js/views/today.js',
  'js/views/upcoming.js',
  'js/voiceInput.js',
  'icons/beacon-180.png',
  'icons/beacon-favicon.png',
  'icons/beacon.png',
  'icons/hearth-180.png',
  'icons/hearth-favicon.png',
  'icons/hearth.png',
  'icons/heather-180.png',
  'icons/heather-favicon.png',
  'icons/heather.png',
  'icons/lakeglow-180.png',
  'icons/lakeglow-favicon.png',
  'icons/lakeglow.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
];

const CDN = 'https://cdn.jsdelivr.net';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One by one so a single failure doesn't abort the whole install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('life-tracker-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, sameOrigin) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: revalidate with the server so a new deploy shows up at once.
    const response = await fetch(request, sameOrigin ? { cache: 'no-cache' } : undefined);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: sameOrigin });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = (await cache.match('index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  // Only the app shell; never Supabase (or anything else).
  if (!sameOrigin && url.origin !== CDN) return;
  event.respondWith(networkFirst(request, sameOrigin));
});
