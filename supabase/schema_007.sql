-- Run once, after schema_006.sql (Magnus runs it with `supabase db query`).
-- Adds: the morning brief, the close-the-day nudge and the weekly planning
-- reminder, sent by the database itself so the phone gets them even while
-- the Mac sleeps. Every 5 minutes pg_cron calls assistant_tick(), which
-- posts due notifications to ntfy.sh (pg_net) on the topic in
-- assistant_settings. Nothing runs for a user without a settings row
-- (`magnus notify setup` creates it). Additive only: older versions of
-- both apps keep working.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 1. assistant_settings: one row per user. The ntfy topic works like a
--    password (anyone who knows it can read the pushes), so it is long and
--    random, and only its owner can read it.
create table assistant_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  ntfy_topic text not null check (ntfy_topic ~ '^[A-Za-z0-9_-]{24,64}$'),
  timezone text not null default 'America/Chicago',
  brief_time time not null default '08:00',
  nudge_enabled boolean not null default true,
  nudge_time time not null default '22:00',
  plan_day smallint check (plan_day between 0 and 6), -- 0 = Sunday; null = no planning reminder
  plan_time time not null default '18:00',
  push_detail text not null default 'full' check (push_detail in ('full', 'counts')),
  web_url text not null default 'https://magnus-web-hq.vercel.app',
  updated_at timestamptz not null default now()
);

-- 2. assistant_days: what was sent each day (so nothing goes out twice) and
--    when the day was closed (`today --close`, or "Done for today").
create table assistant_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  brief_sent_at timestamptz,
  nudge_sent_at timestamptz,
  plan_sent_at timestamptz,
  closed_at timestamptz,
  primary key (user_id, day)
);

alter table assistant_settings enable row level security;
alter table assistant_days enable row level security;

create policy "owner full access" on assistant_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owner full access" on assistant_days
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. The brief's text. Preview it in the SQL editor:
--      select public.build_morning_brief('<your user id>', current_date);
create or replace function public.build_morning_brief(p_user uuid, p_day date, p_detail text default 'full')
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  n_overdue int;
  n_today int;
  n_starred int;
  n_routines int;
  lines text[] := '{}';
  part text;
begin
  select count(*) filter (where due_date < p_day), count(*) filter (where due_date = p_day), count(*) filter (where is_starred)
    into n_overdue, n_today, n_starred
    from public.tasks where user_id = p_user and status <> 'done';
  select count(*) into n_routines from public.routines where user_id = p_user;

  if p_detail = 'counts' then
    return concat_ws(' · ',
      nullif(n_overdue || ' overdue', '0 overdue'),
      nullif(n_today || ' due today', '0 due today'),
      nullif(n_starred || ' starred', '0 starred'),
      nullif(n_routines || ' routines', '0 routines'));
  end if;

  -- A list of at most five titles, then "+N more".
  select string_agg(title, ', ') || case when max(total) > 5 then format(' +%s more', max(total) - 5) else '' end into part
    from (select title || ' (' || to_char(due_date, 'Dy') || ')' as title, count(*) over () as total
            from public.tasks where user_id = p_user and status <> 'done' and due_date < p_day
            order by due_date limit 5) x;
  if part is not null then lines := lines || ('Overdue: ' || part); end if;

  select string_agg(title, ', ') || case when max(total) > 5 then format(' +%s more', max(total) - 5) else '' end into part
    from (select title, count(*) over () as total from public.tasks
           where user_id = p_user and status <> 'done' and due_date = p_day
           order by priority = 'high' desc, sort_order limit 5) x;
  if part is not null then lines := lines || ('Today: ' || part); end if;

  select string_agg(title, ', ') into part
    from (select title from public.tasks where user_id = p_user and status <> 'done' and is_starred
           and (due_date is null or due_date >= p_day) order by sort_order limit 3) x;
  if part is not null then lines := lines || ('Starred: ' || part); end if;

  select string_agg(name || ' (' || to_char(target_date, 'Dy') || ')', ', ') into part
    from (select name, target_date from public.projects where user_id = p_user and status <> 'done'
           and target_date between p_day and p_day + 7 order by target_date limit 3) x;
  if part is not null then lines := lines || ('Projects due this week: ' || part); end if;

  select string_agg(name, ', ') into part
    from (select name from public.routines where user_id = p_user
           order by array_position(array['morning', 'afternoon', 'evening'], time_of_day), sort_order limit 8) x;
  if part is not null then lines := lines || ('Routines: ' || part); end if;

  select string_agg(text, ' · ') into part
    from (select i.text from public.list_items i join public.lists l on l.id = i.list_id
           where l.user_id = p_user and lower(trim(l.name)) = 'goals' and not i.done order by i.sort_order limit 3) x;
  if part is not null then lines := lines || ('Goals: ' || part); end if;

  select string_agg(title, ', ') into part
    from (select title from public.books where user_id = p_user and status = 'reading' order by sort_order limit 3) x;
  if part is not null then lines := lines || ('Reading: ' || part); end if;

  if cardinality(lines) = 0 then return 'Nothing due, nothing overdue. A clear day.'; end if;
  return left(array_to_string(lines, E'\n'), 3500);
end;
$$;

-- 4. One ntfy push (JSON publishing to the ntfy.sh root).
create or replace function public.assistant_push(p_topic text, p_title text, p_message text, p_tags text[], p_click text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://ntfy.sh',
    body := jsonb_build_object('topic', p_topic, 'title', p_title, 'message', p_message, 'tags', to_jsonb(p_tags), 'click', p_click),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end;
$$;

-- 5. The tick (every 5 minutes). Each notification goes out once per day,
--    within a few hours of its time (a brief that missed its window because
--    the database was paused is skipped, not sent at noon).
create or replace function public.assistant_tick()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  local_now timestamp;
  d date;
  t time;
  done_today int;
  routines_done int;
  routines_all int;
begin
  for s in select * from public.assistant_settings where enabled loop
    begin
      local_now := now() at time zone s.timezone;
    exception when others then
      continue; -- an unknown time zone: skip this user rather than fail the tick
    end;
    d := local_now::date;
    t := local_now::time;
    insert into public.assistant_days (user_id, day) values (s.user_id, d) on conflict do nothing;

    if t >= s.brief_time and t - s.brief_time < interval '3 hours' then
      update public.assistant_days set brief_sent_at = now()
       where user_id = s.user_id and day = d and brief_sent_at is null;
      if found then
        perform public.assistant_push(s.ntfy_topic, 'Good morning · ' || to_char(d, 'Dy Mon FMDD'),
          public.build_morning_brief(s.user_id, d, s.push_detail), array['sunrise'], s.web_url);
      end if;
    end if;

    if s.nudge_enabled and t >= s.nudge_time and t - s.nudge_time < interval '2 hours' then
      update public.assistant_days set nudge_sent_at = now()
       where user_id = s.user_id and day = d and nudge_sent_at is null and closed_at is null;
      if found then
        select count(*) into done_today from public.tasks
         where user_id = s.user_id and status = 'done' and (completed_at at time zone s.timezone)::date = d;
        select count(*) into routines_all from public.routines where user_id = s.user_id;
        select count(distinct routine_id) into routines_done from public.routine_completions
         where user_id = s.user_id and completed_date = d;
        perform public.assistant_push(s.ntfy_topic, 'Close the day?',
          format('%s task%s done · %s/%s routines. Run today --close, or tap Done for today.',
            done_today, case when done_today = 1 then '' else 's' end, routines_done, routines_all),
          array['crescent_moon'], s.web_url);
      end if;
    end if;

    if s.plan_day is not null and extract(dow from d) = s.plan_day and t >= s.plan_time and t - s.plan_time < interval '3 hours' then
      update public.assistant_days set plan_sent_at = now()
       where user_id = s.user_id and day = d and plan_sent_at is null;
      if found then
        perform public.assistant_push(s.ntfy_topic, 'Plan your week',
          'Open Magnus and run Plan my week to spread next week''s tasks over the days.', array['calendar'], s.web_url);
      end if;
    end if;
  end loop;
end;
$$;

-- The functions are for the cron job and the SQL editor only, never the API.
revoke execute on function public.build_morning_brief(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.assistant_push(text, text, text, text[], text) from public, anon, authenticated;
revoke execute on function public.assistant_tick() from public, anon, authenticated;

select cron.schedule('assistant-tick', '*/5 * * * *', 'select public.assistant_tick()');
