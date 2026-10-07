-- Run this once in the Supabase SQL Editor, after schema_005.sql.
-- Pins the search_path of the tasks.completed_at trigger function (Supabase
-- Security Advisor: "Function Search Path Mutable"), so the function can't
-- be redirected to look-alike objects in another schema. It only uses
-- now() and coalesce(), which always resolve from pg_catalog. No data or
-- behavior changes; older versions of both apps keep working.

alter function public.set_task_completed_at() set search_path = '';
