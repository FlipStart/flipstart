-- drizzle/sql/hunt_leaderboard_phase4.sql
--
-- Hunt Leaderboard, Phase 4: the final result of every finished week, frozen.
--
-- Run this whole file ONCE in the Supabase SQL editor, AFTER
-- hunt_leaderboard_phase2.sql and BEFORE deploying the server that uses it.
-- It only ADDS things: nothing the current app or server does changes, and it
-- is safe to run again.
--
-- Why this exists. The Weekly board is worked out live from leaderboard_weekly,
-- which keeps every week forever. But "who won the week of 9 November" would
-- still shift later: an account that is deleted or excluded afterwards drops
-- out and everyone below moves up. weekly_results is the answer as it stood
-- when the week closed, kept for winners and trophies later.
--
-- What this adds:
--   weekly_results          one row per ranked hunter per finished week:
--                           final position, XP, and when they reached it
--   weekly_results_weeks    one row per finished week: when it was frozen,
--                           how many hunters, total XP
--   leaderboard_close_week(week)            freeze one finished week (once)
--   leaderboard_close_finished_weeks()      freeze every finished week not yet
--                                           frozen. The server calls this when
--                                           it starts and every 30 minutes.
--   founder controls (bottom of this file): see a week's winners, and freeze a
--                                           week again after excluding a cheater
--
-- Nothing here resets anything. A "reset" is only the calendar moving to a new
-- week_start; this file just writes down how the old week ended.
--
-- Only the server can use any of it (row-level security with no policies).

begin;

-- ── 1. The tables ───────────────────────────────────────────────────────────
create table if not exists public.weekly_results_weeks (
  week_start date primary key,                       -- Monday, America/Los_Angeles
  closed_at  timestamptz not null default now(),
  hunters    integer not null default 0,
  total_xp   bigint  not null default 0
);
alter table public.weekly_results_weeks enable row level security;
revoke all on public.weekly_results_weeks from anon, authenticated;

-- A deleted account takes its rows with it. The positions of everyone else
-- stay exactly as they were frozen (a gap is correct: that place was taken).
create table if not exists public.weekly_results (
  week_start date    not null references public.weekly_results_weeks(week_start) on delete cascade,
  position   integer not null check (position > 0),
  user_id    uuid    not null references auth.users(id) on delete cascade,
  xp         integer not null check (xp > 0),
  reached_at timestamptz not null,
  primary key (week_start, position),
  unique (week_start, user_id)
);
create index if not exists weekly_results_user on public.weekly_results (user_id, week_start desc);
alter table public.weekly_results enable row level security;
revoke all on public.weekly_results from anon, authenticated;

-- ── 2. Freeze one finished week ─────────────────────────────────────────────
-- Returns how many hunters were frozen, or NULL when nothing was done (the
-- week is not over yet, or it is already frozen).
--
-- The order is the live Weekly board's order: more XP first, then whoever
-- reached it first, then a fixed internal order. Excluded accounts are left
-- out, exactly as on the live board. (Blocks are per viewer, so they do not
-- apply to a stored result.)
--
-- A week is only frozen 10 minutes after it ends: an award that started in the
-- last second of Sunday still belongs to that week and may land a moment late.
-- (p_now exists so this rule can be tested; nothing passes it.)
drop function if exists public.leaderboard_close_week(date);
create or replace function public.leaderboard_close_week(p_week date, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ends    timestamptz;
  v_hunters integer;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'a leaderboard week starts on a Monday, got %', p_week;
  end if;

  v_ends := (p_week + 7)::timestamp at time zone 'America/Los_Angeles';
  if coalesce(p_now, now()) < v_ends + interval '10 minutes' then
    return null;                                     -- still running (or only just over)
  end if;

  -- Claim the week. Two callers at once: the second waits here, then finds it taken.
  insert into public.weekly_results_weeks (week_start) values (p_week)
    on conflict (week_start) do nothing;
  if not found then
    return null;                                     -- already frozen
  end if;

  insert into public.weekly_results (week_start, position, user_id, xp, reached_at)
  select p_week,
         row_number() over (order by w.xp desc, w.reached_at asc, w.user_id asc),
         w.user_id, w.xp, w.reached_at
    from public.leaderboard_weekly w
   where w.week_start = p_week
     and w.xp > 0
     and not exists (select 1 from public.xp_profiles x
                      where x.user_id = w.user_id and x.leaderboard_status = 'excluded');
  get diagnostics v_hunters = row_count;

  update public.weekly_results_weeks k
     set hunters  = v_hunters,
         total_xp = coalesce((select sum(r.xp) from public.weekly_results r where r.week_start = p_week), 0)
   where k.week_start = p_week;

  return v_hunters;
end;
$$;

-- ── 3. Freeze every finished week that is not frozen yet ────────────────────
-- Cheap when there is nothing to do, so it can be called often. Returns the
-- weeks it froze, oldest first: [{"week_start": "2026-11-09", "hunters": 12}].
create or replace function public.leaderboard_close_finished_weeks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_this_week date := public.hunt_week_start(now());
  v_week      date;
  v_hunters   integer;
  v_out       jsonb := '[]'::jsonb;
begin
  for v_week in
    select distinct w.week_start
      from public.leaderboard_weekly w
     where w.week_start < v_this_week
       and not exists (select 1 from public.weekly_results_weeks k where k.week_start = w.week_start)
     order by 1
  loop
    v_hunters := public.leaderboard_close_week(v_week);
    if v_hunters is not null then
      v_out := v_out || jsonb_build_object('week_start', v_week, 'hunters', v_hunters);
    end if;
  end loop;
  return v_out;
end;
$$;

-- ── 4. Founder controls (run these yourself, in this SQL editor) ────────────
-- Freeze a week AGAIN, from the kept weekly XP. Use it after excluding a
-- cheater who placed in a week that had already closed: they drop out and
-- everyone below moves up.
create or replace function public.leaderboard_reclose_week(p_week date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hunters integer;
begin
  if not exists (select 1 from public.weekly_results_weeks where week_start = p_week) then
    return 'That week has not been frozen yet (nothing to redo).';
  end if;
  delete from public.weekly_results_weeks where week_start = p_week;   -- its rows go with it
  v_hunters := public.leaderboard_close_week(p_week);
  return format('Week of %s frozen again: %s hunters.', p_week, coalesce(v_hunters, 0));
end;
$$;

-- Every frozen week with names, for you to read. Names here are the ones in
-- the profile (you are the only reader); the app never sees this view.
create or replace view public.weekly_winners
with (security_invoker = true) as
select r.week_start, r.position, p.username, p.display_name, r.xp, r.reached_at, r.user_id
  from public.weekly_results r
  left join public.profiles p on p.id = r.user_id
 order by r.week_start desc, r.position asc;
revoke all on public.weekly_winners from anon, authenticated;

-- ── 5. App users can call none of this ──────────────────────────────────────
revoke all on function public.leaderboard_close_week(date, timestamptz) from public, anon, authenticated;
revoke all on function public.leaderboard_close_finished_weeks() from public, anon, authenticated;
revoke all on function public.leaderboard_reclose_week(date) from public, anon, authenticated;
grant execute on function public.leaderboard_close_week(date, timestamptz) to service_role;
grant execute on function public.leaderboard_close_finished_weeks() to service_role;
grant select, insert, update, delete on public.weekly_results, public.weekly_results_weeks to service_role;

commit;

-- ── Bring it up to date now ─────────────────────────────────────────────────
-- Freezes any week that has already finished. Shows [] when there is none.
select public.leaderboard_close_finished_weeks() as weeks_frozen_now;

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Should list 2 tables.
select tablename from pg_tables
 where schemaname = 'public' and tablename in ('weekly_results', 'weekly_results_weeks')
 order by 1;

-- ── How to use the founder controls ─────────────────────────────────────────
--   select * from public.weekly_results_weeks order by week_start desc;        -- every frozen week
--   select * from public.weekly_winners where position <= 3;                   -- top 3 of every week
--   select * from public.weekly_winners where week_start = '2026-11-09';       -- one whole week
--   select public.leaderboard_reclose_week('2026-11-09');                      -- after excluding a cheater