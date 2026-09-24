// Registers the offline service worker (sw.js). A separate file because the
// Content-Security-Policy doesn't allow inline scripts.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // unsupported context (e.g. private mode): the app just won't open offline
    });
  });
}
