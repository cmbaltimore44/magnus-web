// Features added by supabase/schema_003.sql (tasks.completed_at,
// focus_sessions, log_entries, Realtime) must keep working — just switched
// off with a hint — until that migration has been run.

// Missing table (42P01 / PGRST205) or column (42703 / PGRST204).
const MISSING_CODES = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);

export function isMissingSchema(err) {
  return !!err && MISSING_CODES.has(String(err.code || ''));
}

export const SCHEMA_003_HINT = 'Run supabase/schema_003.sql to enable this.';
