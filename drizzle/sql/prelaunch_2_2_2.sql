-- drizzle/sql/prelaunch_2_2_2.sql
--
-- Everything the database needs before the 2.2.2 build reaches anyone, so the
-- data that measures 2.2.2 exists from its first production user onward.
--
-- ✅ Safe to run any time, and more than once. Adds columns and indexes only;
--    changes no data and no access rules.
-- ✅ Run it BEFORE the 2.2.2 build goes to the App Store (now is fine: the
--    current server and app work the same with or without it).
-- ⚠️  This is NOT the force update. force_update_2_2_2.sql runs only after
--    2.2.2 is live on the App Store. And still: do NOT run hunt_xp_lock.sql
--    until launch day.
--
-- What it does:
--   1. scan_outcomes gets prompt_version and model, so every scan says which
--      prompt and model it ran on (AI quality by version, in Release Impact).
--      Until this runs, the server writes rows without them, so nothing is
--      lost, but those scans' versions are.
--   2. profiles.onboarding_answers, where onboarding saves "How did you first
--      hear about FlipStart?" with the other answers. Already in
--      onboarding_answers.sql; repeated here in case that one never ran.
--   3. An index on analytics_events (created_at, id), which the founder
--      dashboard now pages through newest first.

-- ── 1. Prompt version and model on every scan ───────────────────────────────
do $$
begin
  if to_regclass('public.scan_outcomes') is null then
    raise notice 'scan_outcomes does not exist here — step 1 skipped. Tell Claude.';
    return;
  end if;
  alter table public.scan_outcomes add column if not exists prompt_version text;
  alter table public.scan_outcomes add column if not exists model text;
  comment on column public.scan_outcomes.prompt_version is
    'Scan prompt the analysis ran on, e.g. v1.15.1 or v1.15.1+capture1. Null on the legacy route and on rows written before 2.2.2.';
  comment on column public.scan_outcomes.model is
    'Model the scan ran on (the API''s own snapshot name on a delivered result). Null on the legacy route and on rows written before 2.2.2.';
  create index if not exists scan_outcomes_prompt_version_idx
    on public.scan_outcomes (prompt_version, updated_at);
end $$;

-- ── 2. Onboarding answers (acquisition source) ──────────────────────────────
alter table public.profiles
  add column if not exists onboarding_answers jsonb;

-- ── 3. Dashboard events paging ──────────────────────────────────────────────
create index if not exists analytics_events_created_at_id_idx
  on public.analytics_events (created_at, id);

-- Make the API see the new columns straight away.
notify pgrst, 'reload schema';

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Should list BOTH prompt_version and model:
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'scan_outcomes'
   and column_name in ('prompt_version', 'model');

-- Should be true. False means the app can't save onboarding answers to the
-- profile row (they still land in the account's metadata and in analytics):
-- tell Claude before shipping.
select has_column_privilege('authenticated', 'public.profiles', 'onboarding_answers', 'UPDATE')
       as app_can_save_onboarding_answers;

-- Should include analytics_events_created_at_id_idx:
select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'analytics_events';

-- ── After the first 2.2.2 users (run these then, not now) ───────────────────
-- Scans by prompt and model, last day (expect v1.15.1 and your scan model):
--   select prompt_version, model, count(*) from public.scan_outcomes
--    where updated_at > now() - interval '1 day' group by 1, 2 order by 3 desc;
--
-- The rating users were shown (expect STRONG_BUY / BUY / RISKY_BUY / SKIP,
-- not blanks):
--   select metadata->>'recommendation_shown' as shown, count(*)
--     from public.analytics_events
--    where event_name = 'scan_completed' and app_version = '2.2.2'
--    group by 1 order by 2 desc;
--
-- Where new users say they heard about FlipStart:
--   select onboarding_answers->>'acquisition_source' as source, count(*)
--     from public.profiles
--    where onboarding_answers is not null
--    group by 1 order by 2 desc;