-- drizzle/sql/hunt_xp_phase1.sql
--
-- Hunt XP, Phase 1: the SERVER works out and awards Hunt XP.
--
-- Run this whole file ONCE in the Supabase SQL editor, BEFORE deploying the
-- server that uses it. It only ADDS things: nothing the current app does
-- changes when you run it, and it is safe to run more than once.
--
-- (The second file, hunt_xp_lock.sql, is the one that stops the app writing XP.
--  Run that one later, on launch day. Not now.)
--
-- What this adds:
--   hunt_scans        what the server saw for every Hunt scan (its evidence)
--   hunts             one row per finished Hunt, with its XP and breakdown
--   xp_ledger         every XP award, one row each: the source of truth
--   founding_hunters  who has the Founding Hunter badge
--   hunt_config       two settings (the Founding Hunter cap and end date)
--   xp_profiles       five new columns the server keeps
--   hunt_xp_context() and award_hunt_xp(): the only way XP is awarded
--   hunt_near_photo_matches(): has another account scanned this same photo
--
-- Only the server can use any of it. Every new table has row-level security
-- with no policies, and none of the functions can be called by app users.

begin;

-- ── 1. Evidence for every Hunt scan ─────────────────────────────────────────
create table if not exists public.hunt_scans (
  analysis_id    text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  hunt_id        text not null,
  attempt_id     text not null,
  scanned_at     timestamptz not null default now(),
  -- 64-bit difference hash of the front photo, and its four 16-bit quarters
  photo_hash     text,
  hash_b0        integer,
  hash_b1        integer,
  hash_b2        integer,
  hash_b3        integer,
  photo_count    smallint not null default 1,
  capture_front  text not null default 'unknown',   -- camera | library | unknown
  capture_kind   text,                               -- in_person | screen | screenshot_or_listing | unclear
  soft_fail      boolean not null default false,
  confident_id   boolean not null default false,
  brand          text not null default '',
  category       text not null default '',
  item_key       text,
  resale         numeric not null default 0,
  xp_inputs      jsonb not null default '{}'::jsonb,
  -- filled in when the Hunt is finished
  kept           boolean,
  thrift_price   numeric,
  final_status   text,                               -- normal | reduced | excluded
  final_rating   text,
  status_reasons text[],
  counted_profit numeric,
  completed_at   timestamptz
);
create index if not exists hunt_scans_user_hunt on public.hunt_scans (user_id, hunt_id);
create index if not exists hunt_scans_user_time on public.hunt_scans (user_id, scanned_at desc);
create index if not exists hunt_scans_b0 on public.hunt_scans (hash_b0);
create index if not exists hunt_scans_b1 on public.hunt_scans (hash_b1);
create index if not exists hunt_scans_b2 on public.hunt_scans (hash_b2);
create index if not exists hunt_scans_b3 on public.hunt_scans (hash_b3);
alter table public.hunt_scans enable row level security;
revoke all on public.hunt_scans from anon, authenticated;

-- ── 2. One row per finished Hunt ────────────────────────────────────────────
create table if not exists public.hunts (
  user_id         uuid not null references auth.users(id) on delete cascade,
  hunt_id         text not null,
  completed_at    timestamptz not null default now(),
  week_start      date not null,
  xp              integer not null,
  best_hunt_score integer not null default 0,
  qualifies       boolean not null default false,
  scan_count      integer not null default 0,
  kept_count      integer not null default 0,
  started_at      timestamptz,
  ended_at        timestamptz,
  duration_ms     bigint not null default 0,
  rules_version   text not null,
  result          jsonb not null default '{}'::jsonb,
  primary key (user_id, hunt_id)
);
create index if not exists hunts_user_time on public.hunts (user_id, completed_at desc);
alter table public.hunts enable row level security;
revoke all on public.hunts from anon, authenticated;

-- ── 3. The XP ledger ────────────────────────────────────────────────────────
create table if not exists public.xp_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  source        text not null check (source in ('hunt', 'legacy_import', 'adjustment')),
  ref           text not null,             -- the hunt id, 'legacy', or a note
  xp            integer not null,
  week_start    date,                      -- null for legacy_import: it never counts toward a week
  rules_version text,
  created_at    timestamptz not null default now(),
  unique (user_id, source, ref)
);
create index if not exists xp_ledger_week on public.xp_ledger (week_start, user_id);
alter table public.xp_ledger enable row level security;
revoke all on public.xp_ledger from anon, authenticated;

-- ── 4. Founding Hunters ─────────────────────────────────────────────────────
create table if not exists public.founding_hunters (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  awarded_at timestamptz not null default now()
);
alter table public.founding_hunters enable row level security;
revoke all on public.founding_hunters from anon, authenticated;

create table if not exists public.hunt_config (
  key   text primary key,
  value jsonb not null
);
alter table public.hunt_config enable row level security;
revoke all on public.hunt_config from anon, authenticated;
-- The cap is 2,000. The end date stays empty (open) until launch day sets it.
insert into public.hunt_config (key, value) values ('founding_cap', '2000'::jsonb)
  on conflict (key) do nothing;
insert into public.hunt_config (key, value) values ('founding_deadline', 'null'::jsonb)
  on conflict (key) do nothing;

-- ── 5. New columns on xp_profiles (the server keeps these) ──────────────────
alter table public.xp_profiles add column if not exists week_streak      integer not null default 0;
alter table public.xp_profiles add column if not exists last_streak_week date;
alter table public.xp_profiles add column if not exists last_hunt_day    date;
alter table public.xp_profiles add column if not exists xp_version       integer not null default 0;
alter table public.xp_profiles add column if not exists xp_reached_at    timestamptz;
alter table public.xp_profiles add column if not exists leaderboard_status text not null default 'normal';

-- last_hunt_day starts from the date the app already saved, when it is a clean date.
update public.xp_profiles x
   set last_hunt_day = (to_jsonb(x) ->> 'last_hunt_date')::date
 where x.last_hunt_day is null
   and (to_jsonb(x) ->> 'last_hunt_date') ~ '^\d{4}-\d{2}-\d{2}$';

-- ── 6. The week: Monday 00:00 in America/Los_Angeles ────────────────────────
-- The ONE definition of a leaderboard week. Nothing else works out a week.
create or replace function public.hunt_week_start(p_at timestamptz)
returns date
language sql
immutable
as $$
  select (date_trunc('week', p_at at time zone 'America/Los_Angeles'))::date;
$$;

-- ── 7. Clock + profile, read together ───────────────────────────────────────
create or replace function public.hunt_xp_context(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_week date := public.hunt_week_start(v_now);
  v_row  jsonb;
begin
  select to_jsonb(x) into v_row from public.xp_profiles x where x.user_id = p_user_id;
  return jsonb_build_object(
    'now',             v_now,
    'week_start',      v_week,
    'prev_week_start', v_week - 7,
    'profile',         coalesce(v_row, '{}'::jsonb)
  );
end;
$$;

-- ── 7b. Has anyone else used this photo? ────────────────────────────────────
-- For each photo fingerprint given, up to 3 OTHER accounts that scanned a
-- near-identical photo (at most p_max_bits of the 64 bits differ). Finishing a
-- Hunt uses it to spot pictures taken from the web: the same image from two or
-- more other accounts is a shared image.
--
-- It compares inside the database and returns only real matches, so the answer
-- stays small and complete however many scans exist. (Asking the table for
-- "everything that shares a quarter of the fingerprint" and comparing on the
-- server stops being complete once that list passes 1,000 rows, which is the
-- most Supabase returns for one request.)
create or replace function public.hunt_near_photo_matches(
  p_user_id  uuid,
  p_hashes   text[],
  p_max_bits integer default 6
)
returns table (photo_hash text, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.photo_hash, m.user_id
    from (select distinct h.hex from unnest(p_hashes) as h(hex) where h.hex ~ '^[0-9a-f]{16}$') q
   cross join lateral (
     select ('x' || q.hex)::bit(64)                        as bits,
            ('x' || substr(q.hex,  1, 4))::bit(16)::integer as b0,
            ('x' || substr(q.hex,  5, 4))::bit(16)::integer as b1,
            ('x' || substr(q.hex,  9, 4))::bit(16)::integer as b2,
            ('x' || substr(q.hex, 13, 4))::bit(16)::integer as b3
   ) k
   cross join lateral (
     select distinct on (s.user_id) s.user_id, s.photo_hash
       from public.hunt_scans s
      where (s.hash_b0 = k.b0 or s.hash_b1 = k.b1 or s.hash_b2 = k.b2 or s.hash_b3 = k.b3)
        and s.user_id <> p_user_id
        and s.photo_hash ~ '^[0-9a-f]{16}$'
        and bit_count(('x' || s.photo_hash)::bit(64) # k.bits) <= greatest(coalesce(p_max_bits, 6), 0)
      order by s.user_id
      limit 3
   ) m;
$$;

-- ── 8. Award a finished Hunt. Exactly once, all or nothing. ─────────────────
create or replace function public.award_hunt_xp(
  p_user_id               uuid,
  p_hunt_id               text,
  p_expected_version      integer,
  p_week_start            date,
  p_xp                    integer,
  p_best_score            integer,
  p_qualifies             boolean,
  p_scan_count            integer,
  p_kept_count            integer,
  p_started_at            timestamptz,
  p_ended_at              timestamptz,
  p_duration_ms           bigint,
  p_rules_version         text,
  p_result                jsonb,
  p_discovered_brands     jsonb,
  p_discovered_categories jsonb,
  p_week_streak           integer,
  p_last_streak_week      date,
  p_items                 jsonb,
  p_ranks                 jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_week      date := public.hunt_week_start(v_now);
  v_today     date := (v_now at time zone 'America/Los_Angeles')::date;
  v_existing  jsonb;
  v_row       jsonb;
  v_before    integer;
  v_after     integer;
  v_completed integer;
  v_day_streak integer;
  v_last_day  date;
  v_rank      text;
  v_applied   jsonb;
  v_raw       jsonb;
  v_result    jsonb;
  v_founding  boolean := false;
  v_cap       integer;
  v_deadline  timestamptz;
  v_new       jsonb;
begin
  if p_xp is null or p_xp < 0 then
    raise exception 'xp must be zero or more';
  end if;

  -- One award per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('hunt_xp:' || p_user_id::text, 0));

  -- Already awarded: hand back the first result, change nothing.
  select h.result into v_existing from public.hunts h
   where h.user_id = p_user_id and h.hunt_id = p_hunt_id;
  if found then
    select to_jsonb(x) into v_row from public.xp_profiles x where x.user_id = p_user_id;
    return jsonb_build_object('status', 'already', 'result', v_existing, 'profile', v_row,
      'founding', exists (select 1 from public.founding_hunters f where f.user_id = p_user_id));
  end if;

  -- A profile row for a first-time hunter. Built as JSON so it fits the table's
  -- existing column types whatever they are.
  if not exists (select 1 from public.xp_profiles x where x.user_id = p_user_id) then
    v_new := jsonb_build_object(
      'user_id', p_user_id, 'total_xp', 0, 'current_rank', p_ranks -> 0 ->> 'rank',
      'completed_hunts', 0, 'hunt_streak', 0,
      'discovered_brands', '[]'::jsonb, 'discovered_categories', '[]'::jsonb,
      'raw_profile', '{}'::jsonb);
    insert into public.xp_profiles
      (user_id, total_xp, current_rank, completed_hunts, hunt_streak, discovered_brands, discovered_categories, raw_profile)
    select r.user_id, r.total_xp, r.current_rank, r.completed_hunts, r.hunt_streak,
           r.discovered_brands, r.discovered_categories, r.raw_profile
      from jsonb_populate_record(null::public.xp_profiles, v_new) r
    on conflict (user_id) do nothing;
  end if;

  select to_jsonb(x) into v_row from public.xp_profiles x where x.user_id = p_user_id for update;

  -- The score was worked out against a profile and a week. If either has moved,
  -- say so; the server reads again and re-scores. A missing version or week is
  -- treated as "moved", never as "fine".
  if coalesce((v_row ->> 'xp_version')::integer, 0) is distinct from p_expected_version
     or p_week_start is distinct from v_week then
    return jsonb_build_object('status', 'conflict');
  end if;

  v_before    := coalesce((v_row ->> 'total_xp')::numeric, 0)::integer;
  v_after     := v_before + p_xp;
  v_completed := coalesce((v_row ->> 'completed_hunts')::numeric, 0)::integer + 1;
  v_last_day  := (v_row ->> 'last_hunt_day')::date;
  v_day_streak := case
    when v_last_day = v_today     then greatest(coalesce((v_row ->> 'hunt_streak')::numeric, 0)::integer, 1)
    when v_last_day = v_today - 1 then coalesce((v_row ->> 'hunt_streak')::numeric, 0)::integer + 1
    else 1 end;

  select r ->> 'rank' into v_rank
    from jsonb_array_elements(p_ranks) r
   where (r ->> 'xp')::integer <= v_after
   order by (r ->> 'xp')::integer desc
   limit 1;

  -- Founding Hunter: first finished Hunt, while there is room and time.
  -- The count is taken under a lock so two people can never both take the last
  -- place. The lock is only asked for while a place could still be free, so once
  -- the badge is closed it costs nothing.
  if not exists (select 1 from public.founding_hunters f where f.user_id = p_user_id) then
    select (c.value #>> '{}')::integer into v_cap from public.hunt_config c where c.key = 'founding_cap';
    select (c.value #>> '{}')::timestamptz into v_deadline from public.hunt_config c where c.key = 'founding_deadline';
    if (v_deadline is null or v_now <= v_deadline)
       and (select count(*) from public.founding_hunters) < coalesce(v_cap, 2000) then
      perform pg_advisory_xact_lock(hashtextextended('founding_hunters', 0));
      if (select count(*) from public.founding_hunters) < coalesce(v_cap, 2000) then
        insert into public.founding_hunters (user_id, awarded_at) values (p_user_id, v_now)
          on conflict (user_id) do nothing;
        v_founding := true;
      end if;
    end if;
  else
    v_founding := true;
  end if;

  v_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object(
    'previousTotalXp', v_before, 'newTotalXp', v_after, 'foundingHunter', v_founding);

  insert into public.hunts
    (user_id, hunt_id, completed_at, week_start, xp, best_hunt_score, qualifies, scan_count, kept_count,
     started_at, ended_at, duration_ms, rules_version, result)
  values
    (p_user_id, p_hunt_id, v_now, v_week, p_xp, coalesce(p_best_score, 0), coalesce(p_qualifies, false),
     coalesce(p_scan_count, 0), coalesce(p_kept_count, 0), p_started_at, p_ended_at,
     coalesce(p_duration_ms, 0), p_rules_version, v_result);

  insert into public.xp_ledger (user_id, source, ref, xp, week_start, rules_version)
  values (p_user_id, 'hunt', p_hunt_id, p_xp, v_week, p_rules_version);

  -- The profile the app reads. raw_profile keeps the shape the app has always read.
  select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_applied from (
    select e, n from jsonb_array_elements(
      case when jsonb_typeof(v_row -> 'raw_profile' -> 'appliedHuntIds') = 'array'
           then v_row -> 'raw_profile' -> 'appliedHuntIds' else '[]'::jsonb end
      || to_jsonb(p_hunt_id)) with ordinality t(e, n)
    order by n desc limit 200
  ) recent;

  v_raw := jsonb_build_object(
    'totalXp', v_after, 'currentRank', v_rank, 'completedHunts', v_completed,
    'lastHuntDate', to_char(v_today, 'YYYY-MM-DD'), 'huntStreak', v_day_streak,
    'weekStreak', coalesce(p_week_streak, 0),
    'discoveredBrands', coalesce(p_discovered_brands, '[]'::jsonb),
    'discoveredCategories', coalesce(p_discovered_categories, '[]'::jsonb),
    'appliedHuntIds', v_applied, 'serverManaged', true);

  v_new := jsonb_build_object(
    'total_xp', v_after, 'current_rank', v_rank, 'completed_hunts', v_completed,
    'hunt_streak', v_day_streak, 'last_hunt_date', to_char(v_today, 'YYYY-MM-DD'),
    'discovered_brands', coalesce(p_discovered_brands, '[]'::jsonb),
    'discovered_categories', coalesce(p_discovered_categories, '[]'::jsonb),
    'raw_profile', v_raw);

  update public.xp_profiles x
     set total_xp = r.total_xp, current_rank = r.current_rank, completed_hunts = r.completed_hunts,
         hunt_streak = r.hunt_streak, last_hunt_date = r.last_hunt_date,
         discovered_brands = r.discovered_brands, discovered_categories = r.discovered_categories,
         raw_profile = r.raw_profile,
         week_streak = coalesce(p_week_streak, 0), last_streak_week = p_last_streak_week,
         last_hunt_day = v_today, xp_version = x.xp_version + 1,
         xp_reached_at = case when p_xp > 0 then v_now else x.xp_reached_at end
    from jsonb_populate_record(null::public.xp_profiles, v_new) r
   where x.user_id = p_user_id;

  -- What each scan ended up counting as.
  update public.hunt_scans s
     set kept = (i ->> 'kept')::boolean,
         thrift_price = (i ->> 'thriftPrice')::numeric,
         final_status = i ->> 'status',
         final_rating = i ->> 'rating',
         status_reasons = array(select jsonb_array_elements_text(coalesce(i -> 'reasons', '[]'::jsonb))),
         counted_profit = (i ->> 'countedProfit')::numeric,
         completed_at = v_now
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
   where s.analysis_id = i ->> 'id' and s.user_id = p_user_id and s.hunt_id = p_hunt_id;

  select to_jsonb(x) into v_row from public.xp_profiles x where x.user_id = p_user_id;
  return jsonb_build_object('status', 'awarded', 'result', v_result, 'profile', v_row,
    'total_before', v_before, 'total_after', v_after, 'founding', v_founding);
end;
$$;

-- App users can never call these. Only the server (service role) can.
revoke all on function public.hunt_week_start(timestamptz) from public, anon, authenticated;
revoke all on function public.hunt_xp_context(uuid) from public, anon, authenticated;
revoke all on function public.hunt_near_photo_matches(uuid, text[], integer) from public, anon, authenticated;
grant execute on function public.hunt_near_photo_matches(uuid, text[], integer) to service_role;
revoke all on function public.award_hunt_xp(uuid, text, integer, date, integer, integer, boolean, integer, integer,
  timestamptz, timestamptz, bigint, text, jsonb, jsonb, jsonb, integer, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hunt_week_start(timestamptz) to service_role;
grant execute on function public.hunt_xp_context(uuid) to service_role;
grant execute on function public.award_hunt_xp(uuid, text, integer, date, integer, integer, boolean, integer, integer,
  timestamptz, timestamptz, bigint, text, jsonb, jsonb, jsonb, integer, date, jsonb, jsonb) to service_role;
grant select, insert, update, delete on public.hunt_scans, public.hunts, public.xp_ledger,
  public.founding_hunters, public.hunt_config to service_role;
-- The ledger's row counter. Nothing in the app could reach it (its table is
-- closed), but a Supabase project hands new sequences to app users by default.
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.xp_ledger', 'id'));
end $$;

commit;

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Run this after the block above. It should list 5 tables and 4 functions.
select 'table' as kind, tablename as name from pg_tables
 where schemaname = 'public' and tablename in ('hunt_scans', 'hunts', 'xp_ledger', 'founding_hunters', 'hunt_config')
union all
select 'function', proname from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('hunt_week_start', 'hunt_xp_context', 'award_hunt_xp', 'hunt_near_photo_matches')
order by 1, 2;