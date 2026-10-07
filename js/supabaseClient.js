import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { resilientFetch } from './resilientFetch.js';
import { makeOfflineFetch, useStoredSessionWhenOffline } from './offline.js';

// To run your own copy, replace these with your Supabase project's values
// (Settings -> API) and load supabase/schema*.sql in order.
// The anon key is meant to be public — access is enforced by Row Level
// Security policies on each table, not by keeping this secret.
const SUPABASE_URL = 'https://jzucxygvjqywxznderfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dWN4eWd2anF5d3h6bmRlcmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MjIwMTAsImV4cCI6MjEwNDM5ODAxMH0.5XbwR8okN3uILNfHXDVUzUQvyrBX6wCFvHdr2WbD1rQ';

// resilientFetch retries the "JWT issued at future" race right after a
// token refresh (see js/resilientFetch.js); the offline layer around it
// saves reads for offline use and blocks writes while offline (js/offline.js).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: makeOfflineFetch(resilientFetch) },
});
useStoredSessionWhenOffline(supabase, supabase.storageKey);
