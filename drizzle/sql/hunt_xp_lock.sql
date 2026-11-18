-- drizzle/sql/hunt_xp_lock.sql
--
-- LAUNCH DAY ONLY. Do not run this yet.
--
-- Run it once, in the Supabase SQL editor, when ALL of these are true:
--   1. hunt_xp_phase1.sql has been run
--   2. the new server is live on Railway
--   3. the new app build is live on the App Store
--   4. the force update to that build is switched on (app_min_version)
--
-- Why the order matters: after this file, the app can no longer write XP itself.
-- App versions before the new build work XP out on the phone, so on those
-- versions XP earned after this point would not be saved. With the force update
-- on, nobody is left on those versions.
--
-- What it does:
--   A. carries everyone's current XP into the ledger (the All-Time board), once
--   B. gives the Founding Hunter badge to everyone who already finished a Hunt
--   C. starts the 60-day Founding Hunter window
--   D. stops the app writing to xp_profiles (it can still READ its own row)
--
-- Safe to run more than once: A and B skip anyone already done, C only sets
-- the end date if it is still empty, D is a no-op the second time.
--
-- It can stop itself. Until this file runs the app can still write its own XP,
-- so a number in xp_profiles is only what a phone said, and step A is about to
-- make it permanent on the All-Time board. If any account holds more than
-- 5,000 XP that the server never awarded, the file stops before changing
-- anything and names the accounts (the highest real total in November 2026 was
-- 528). Look at them, then either correct them or raise the limit in step 0.

begin;

-- ── 0. Look before importing ────────────────────────────────────────────────
do $$
declare
  v_limit constant integer := 5000;     -- raise only after looking at the accounts it names
  v_count integer;
  v_who   text;
begin
  select count(*), string_agg(format('%s (%s XP)', t.user_id, t.unexplained), ', ' order by t.unexplained desc) filter (where t.rn <= 5)
    into v_count, v_who
    from (
      select x.user_id,
             coalesce(x.total_xp, 0) - coalesce(l.xp, 0) as unexplained,
             row_number() over (order by coalesce(x.total_xp, 0) - coalesce(l.xp, 0) desc) as rn
        from public.xp_profiles x
        left join (select user_id, sum(xp)::integer as xp from public.xp_ledger group by user_id) l
               on l.user_id = x.user_id
       where coalesce(x.total_xp, 0) - coalesce(l.xp, 0) > v_limit
    ) t;
  if v_count > 0 then
    raise exception using
      message = format('Stopped. Nothing was changed. %s account(s) hold more than %s XP that the server never awarded: %s', v_count, v_limit, v_who),
      hint = 'Look at each one in xp_profiles and in the User Explorer. Then correct its total_xp, or raise v_limit in step 0 of this file, and run the file again.';
  end if;
end $$;

-- ── A. Current XP into the ledger ───────────────────────────────────────────
-- One 'legacy_import' row per account: its XP today, minus anything the server
-- already awarded through the ledger. No recalculation. Nobody's XP changes.
insert into public.xp_ledger (user_id, source, ref, xp, week_start, rules_version)
select x.user_id, 'legacy_import', 'legacy',
       greatest(x.total_xp::integer - coalesce(l.server_xp, 0), 0),
       null, 'legacy'
  from public.xp_profiles x
  left join (
    select user_id, sum(xp)::integer as server_xp
      from public.xp_ledger where source <> 'legacy_import' group by user_id
  ) l on l.user_id = x.user_id
 where x.total_xp::integer - coalesce(l.server_xp, 0) > 0
on conflict (user_id, source, ref) do nothing;

-- When each account reached its XP, for leaderboard tie-breaks. Existing XP
-- counts as reached now.
update public.xp_profiles set xp_reached_at = now()
 where xp_reached_at is null and total_xp::integer > 0;

-- ── B. Founding Hunters: everyone who already finished a Hunt ───────────────
insert into public.founding_hunters (user_id)
select x.user_id from public.xp_profiles x
 where x.completed_hunts::integer > 0
on conflict (user_id) do nothing;

-- ── C. The 60-day window starts now ─────────────────────────────────────────
update public.hunt_config
   set value = to_jsonb(now() + interval '60 days')
 where key = 'founding_deadline' and value = 'null'::jsonb;

-- ── D. The app can no longer write XP ───────────────────────────────────────
drop policy if exists "Users can insert own xp profile" on public.xp_profiles;
drop policy if exists "Users can update own xp profile" on public.xp_profiles;
drop policy if exists "Users can delete own xp profile" on public.xp_profiles;
revoke insert, update, delete, truncate, references, trigger on public.xp_profiles from anon, authenticated;

commit;

-- ── Check it worked ─────────────────────────────────────────────────────────
-- 1. Only the SELECT policy should be left on xp_profiles.
select policyname, cmd from pg_policies where tablename = 'xp_profiles';

-- 2. Ledger total should equal profile total for every account (no rows = all good).
select x.user_id, x.total_xp, coalesce(l.xp, 0) as ledger_xp
  from public.xp_profiles x
  left join (select user_id, sum(xp) as xp from public.xp_ledger group by user_id) l using (user_id)
 where x.total_xp::integer <> coalesce(l.xp, 0);

-- 3. Founding Hunters so far, and when the window closes.
select (select count(*) from public.founding_hunters) as founding_hunters,
       (select value from public.hunt_config where key = 'founding_deadline') as window_closes;