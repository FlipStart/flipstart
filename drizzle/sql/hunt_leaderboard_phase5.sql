-- drizzle/sql/hunt_leaderboard_phase5.sql
--
-- Hunt Leaderboard, Phase 5: lets the founder dashboard read the leaderboard's
-- tables and use the founder controls with a button instead of the SQL editor.
--
-- Run this whole file ONCE in the Supabase SQL editor, AFTER
-- hunt_leaderboard_phase4.sql and BEFORE deploying the server that uses it.
-- It only ADDS things (permissions for the server, and three indexes). Nothing
-- the app does changes, and it is safe to run again.
--
-- Until this file is run, the dashboard's leaderboard buttons answer
-- "permission denied" and change nothing; everything else keeps working.
--
-- App users still cannot call or read any of this: every grant below is to
-- service_role only, which is the key that lives on the server.

begin;

-- ── 1. The founder controls, callable by the server ─────────────────────────
-- These were written in phases 2 and 4 for you to run by hand. The dashboard's
-- buttons call the same functions, behind FOUNDER_DASHBOARD_SECRET.
grant execute on function public.leaderboard_set_excluded(uuid, boolean)      to service_role;
grant execute on function public.leaderboard_review_avatar(uuid, boolean)     to service_role;
grant execute on function public.leaderboard_review_name(uuid, boolean)       to service_role;
grant execute on function public.leaderboard_close_cheating_reports(uuid)     to service_role;
grant execute on function public.leaderboard_reclose_week(date)               to service_role;

-- ── 2. What the dashboard reads ─────────────────────────────────────────────
-- Stated outright, so the dashboard does not depend on project defaults.
grant select on public.hunts, public.hunt_scans, public.xp_ledger, public.founding_hunters to service_role;
grant select on public.leaderboard_open_reports, public.weekly_winners               to service_role;

-- ── 3. Indexes for the dashboard's reads ────────────────────────────────────
-- Hunts and Hunt scans in a date range, and the "1,000+ XP" review queue.
create index if not exists hunts_completed_at  on public.hunts (completed_at);
create index if not exists hunt_scans_scanned  on public.hunt_scans (scanned_at);
create index if not exists hunts_big_awards    on public.hunts (completed_at desc) where xp >= 1000;

commit;

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Should list 5 functions, each with server_can_call = true and app_can_call = false.
select p.proname as function,
       has_function_privilege('service_role', p.oid, 'execute')  as server_can_call,
       has_function_privilege('authenticated', p.oid, 'execute') as app_can_call
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('leaderboard_set_excluded', 'leaderboard_review_avatar', 'leaderboard_review_name',
                     'leaderboard_close_cheating_reports', 'leaderboard_reclose_week')
 order by 1;