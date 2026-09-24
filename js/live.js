import { supabase } from './supabaseClient.js';

// Live updates: when anything changes in the database (another device,
// Magnus, or this tab), refresh the current view shortly after. Needs the
// tables in the supabase_realtime publication (schema_003); if subscribing
// fails the app quietly keeps its refresh-on-focus behavior instead.

const DEBOUNCE_MS = 700;
const RETRY_MS = 1500;

// refresh(): re-render the current view. canRefresh(): false while that would
// throw away unsaved input (an open dialog, a half-filled form).
export function initLiveUpdates(refresh, canRefresh) {
  let timer = null;

  const run = () => {
    timer = null;
    if (document.hidden) return; // refresh-on-focus covers coming back
    if (!canRefresh()) {
      timer = setTimeout(run, RETRY_MS); // try again once the dialog closes
      return;
    }
    refresh();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  let channel = null;
  try {
    channel = supabase
      .channel('life-tracker-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, schedule)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime isn't available (e.g. schema_003 not run yet): stop
          // retrying and rely on refresh-on-focus.
          supabase.removeChannel(channel);
          channel = null;
        }
      });
  } catch {
    channel = null;
  }
}
