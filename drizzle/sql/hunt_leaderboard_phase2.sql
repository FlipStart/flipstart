-- drizzle/sql/hunt_leaderboard_phase2.sql
--
-- Hunt Leaderboard, Phase 2: the boards, public names and pictures, reports and
-- blocks.
--
-- Run this whole file ONCE in the Supabase SQL editor, AFTER hunt_xp_phase1.sql
-- and BEFORE deploying the server that uses it. Like phase 1 it only ADDS
-- things: nothing the current app does changes, and it is safe to run again.
--
-- What this adds:
--   leaderboard_weekly     XP per account per week (kept forever, never reset)
--   leaderboard_best_hunt  each account's best qualifying Hunt
--   leaderboard_identity   the name and picture OTHER people may see, after
--                          moderation. The app cannot write it.
--   profile_reports        reports made from the leaderboard
--   user_blocks            who has blocked whom
--   a trigger on hunts     keeps the two board tables up to date with every award
--   leaderboard_page()     one board, one page, plus "your rank"
--   report / block functions, and founder controls (bottom of this file)
--   a public storage bucket for moderated profile pictures
--
-- Only the server can use any of it: every table has row-level security with no
-- policies, and no function here can be called by app users.

begin;

-- ── 1. Weekly XP ────────────────────────────────────────────────────────────
-- One row per account per week. "Reset" just means a new week_start: old weeks
-- stay, so past winners and trophies can be built later.
create table if not exists public.leaderboard_weekly (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  xp         integer not null default 0,
  reached_at timestamptz not null default now(),   -- when it reached this XP: ties go to whoever got there first
  primary key (user_id, week_start)
);
create index if not exists leaderboard_weekly_rank
  on public.leaderboard_weekly (week_start, xp desc, reached_at asc, user_id);
alter table public.leaderboard_weekly enable row level security;
revoke all on public.leaderboard_weekly from anon, authenticated;

-- ── 2. Best Hunt ────────────────────────────────────────────────────────────
create table if not exists public.leaderboard_best_hunt (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  hunt_id     text not null,
  score       integer not null,
  achieved_at timestamptz not null
);
create index if not exists leaderboard_best_hunt_rank
  on public.leaderboard_best_hunt (score desc, achieved_at asc, user_id);
alter table public.leaderboard_best_hunt enable row level security;
revoke all on public.leaderboard_best_hunt from anon, authenticated;

-- (The All-Time board's index is created with leaderboard_page(), further down.)

-- ── 3. What other people may see of an account ──────────────────────────────
-- profiles is editable by its owner, so nothing in it can be trusted as "safe to
-- show". The server reads the profile, moderates the name and picture, and
-- writes the result HERE. Leaderboard responses are built from this table only.
create table if not exists public.leaderboard_identity (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  -- A handle for this account that is safe to hand to other users (for reports
  -- and blocks). Random, and unrelated to the real account id.
  public_id         uuid not null unique default gen_random_uuid(),
  public_name       text,                              -- approved name; null shows "Hunter"
  name_source       text,                              -- the profile name this decision was made for
  name_status       text not null default 'pending',   -- approved | rejected | pending
  avatar_url        text,                              -- approved public copy; null shows the default picture
  avatar_source     text,                              -- the profile picture this decision was made for
  avatar_status     text not null default 'none',      -- approved | rejected | pending | none
  name_hidden       boolean not null default false,    -- hidden by reports or by you
  avatar_hidden     boolean not null default false,
  name_cleared_at   timestamptz,                       -- reports before this no longer count
  avatar_cleared_at timestamptz,
  checked_at        timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.leaderboard_identity enable row level security;
revoke all on public.leaderboard_identity from anon, authenticated;

-- ── 4. Reports and blocks ───────────────────────────────────────────────────
create table if not exists public.profile_reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id   uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('photo', 'name', 'cheating')),
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_id, reason)
);
create index if not exists profile_reports_target on public.profile_reports (target_id, reason, status);
alter table public.profile_reports enable row level security;
revoke all on public.profile_reports from anon, authenticated;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;

-- ── 5. Every award updates the boards, in the same transaction ──────────────
create or replace function public.leaderboard_on_hunt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leaderboard_identity (user_id) values (new.user_id)
    on conflict (user_id) do nothing;

  if new.xp > 0 then
    insert into public.leaderboard_weekly as w (user_id, week_start, xp, reached_at)
    values (new.user_id, new.week_start, new.xp, new.completed_at)
    on conflict (user_id, week_start) do update
      set xp = w.xp + excluded.xp, reached_at = excluded.reached_at;
  end if;

  -- A new personal best must be strictly higher: an equal score keeps the earlier Hunt.
  if new.qualifies and new.best_hunt_score > 0 then
    insert into public.leaderboard_best_hunt as b (user_id, hunt_id, score, achieved_at)
    values (new.user_id, new.hunt_id, new.best_hunt_score, new.completed_at)
    on conflict (user_id) do update
      set hunt_id = excluded.hunt_id, score = excluded.score, achieved_at = excluded.achieved_at
      where excluded.score > b.score;
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_leaderboard on public.hunts;
create trigger hunts_leaderboard
  after insert on public.hunts
  for each row execute function public.leaderboard_on_hunt();

-- ── 6. Bring the boards up to date with Hunts already awarded ───────────────
-- Rebuilt from the hunts table, so running this again always gives the same answer.
insert into public.leaderboard_weekly as w (user_id, week_start, xp, reached_at)
select h.user_id, h.week_start, sum(h.xp)::integer, max(h.completed_at)
  from public.hunts h where h.xp > 0
 group by h.user_id, h.week_start
on conflict (user_id, week_start) do update
  set xp = excluded.xp, reached_at = excluded.reached_at;

insert into public.leaderboard_best_hunt as b (user_id, hunt_id, score, achieved_at)
select distinct on (h.user_id) h.user_id, h.hunt_id, h.best_hunt_score, h.completed_at
  from public.hunts h
 where h.qualifies and h.best_hunt_score > 0
 order by h.user_id, h.best_hunt_score desc, h.completed_at asc
on conflict (user_id) do update
  set hunt_id = excluded.hunt_id, score = excluded.score, achieved_at = excluded.achieved_at;

insert into public.leaderboard_identity (user_id)
select x.user_id from public.xp_profiles x
on conflict (user_id) do nothing;

-- ── 7. One board, one page, and "your rank" ─────────────────────────────────
-- p_board:  weekly | all_time | best_hunt
-- p_viewer: the signed-in account, or null
-- p_after:  positions already shown (0 for the first page)
--
-- Order everywhere: higher number first, then whoever reached it first, then a
-- fixed internal order, so two requests can never disagree about a tie.
-- Left out: accounts you excluded, and accounts this viewer blocked.
--
-- The result carries real account ids so the SERVER can refresh names and
-- pictures. The server removes them before anything reaches the app.
--
-- How it stays fast with many accounts. Nothing here sorts a whole board:
--   the page       walks the board's index in order and stops after the page
--   "ranked"       one count over the board
--   your position  one count of the accounts ahead of you
--   the one above  the nearest account ahead of you, read backwards off the index
-- Each board reads through its own index, which is why leaderboard_rank() puts
-- its queries together per board. Only fixed text is ever put together: the
-- board name is checked against the three names first, and every value is
-- passed as a parameter.
create index if not exists xp_profiles_all_time_order
  on public.xp_profiles (total_xp desc, xp_reached_at asc nulls first, user_id);
drop index if exists public.xp_profiles_all_time_rank;        -- replaced by the index above
create index if not exists xp_profiles_excluded
  on public.xp_profiles (user_id) where leaderboard_status = 'excluded';

-- The ranking itself: read-only, and every part of one answer is taken from the
-- same instant, so a page and "your rank" can never disagree with each other.
create or replace function public.leaderboard_rank(
  p_board  text,
  p_viewer uuid,
  p_week   date,
  p_after  integer,
  p_limit  integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_src    text;      -- this board's entries: user_id, metric, reached_at (above zero only)
  v_first  text;      -- best first
  v_last   text;      -- the same order, backwards
  v_seen   text;      -- not excluded by you, not blocked by this viewer
  v_ahead  text;      -- "ranked above the viewer"
  v_ranked integer;
  v_page   jsonb;     -- [{user_id, pos, metric}]
  v_mine   boolean;
  v_me_metric  integer;
  v_me_reached timestamptz;
  v_me_pos     integer;
  v_above      integer;
begin
  -- $1 = the viewer, $2 = the week, $3 / $4 = the viewer's own number and time,
  -- $5 / $6 = where the page starts and how long it is.
  if p_board = 'weekly' then
    v_src   := 'select w.user_id, w.xp as metric, w.reached_at from public.leaderboard_weekly w where w.week_start = $2 and w.xp > 0';
    v_first := 'e.metric desc, e.reached_at asc, e.user_id asc';
    v_last  := 'e.metric asc, e.reached_at desc, e.user_id desc';
  elsif p_board = 'all_time' then
    -- XP with no "reached" time yet counts as reached first.
    v_src   := 'select x.user_id, x.total_xp as metric, x.xp_reached_at as reached_at from public.xp_profiles x where x.total_xp > 0';
    v_first := 'e.metric desc, e.reached_at asc nulls first, e.user_id asc';
    v_last  := 'e.metric asc, e.reached_at desc nulls last, e.user_id desc';
  elsif p_board = 'best_hunt' then
    v_src   := 'select b.user_id, b.score as metric, b.achieved_at as reached_at from public.leaderboard_best_hunt b where b.score > 0';
    v_first := 'e.metric desc, e.reached_at asc, e.user_id asc';
    v_last  := 'e.metric asc, e.reached_at desc, e.user_id desc';
  else
    raise exception 'unknown board %', p_board;
  end if;

  v_seen := ' and e.user_id not in (select h.user_id from public.xp_profiles h where h.leaderboard_status = ''excluded'')'
         || ' and ($1 is null or e.user_id not in (select k.blocked_id from public.user_blocks k where k.blocker_id = $1))';
  v_ahead := ' and e.metric >= $3 and (e.metric > $3'
          || ' or coalesce(e.reached_at, ''-infinity''::timestamptz) < coalesce($4, ''-infinity''::timestamptz)'
          || ' or (coalesce(e.reached_at, ''-infinity''::timestamptz) = coalesce($4, ''-infinity''::timestamptz) and e.user_id < $1))';

  -- How many are on the board.
  execute 'select count(*)::integer from (' || v_src || ') e where true' || v_seen
    into v_ranked using p_viewer, p_week;

  -- The page.
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''user_id'', t.user_id, ''pos'', $5 + t.n, ''metric'', t.metric) order by t.n), ''[]''::jsonb)'
       || ' from (select e.user_id, e.metric, row_number() over (order by ' || v_first || ') as n'
       || '         from (select e.* from (' || v_src || ') e where true' || v_seen
       || '               order by ' || v_first || ' offset $5 limit $6) e) t'
    into v_page using p_viewer, p_week, null::integer, null::timestamptz, p_after, p_limit;

  -- The viewer's own place: one more than the number of accounts ahead.
  if p_viewer is not null then
    execute 'select true, e.metric, e.reached_at from (' || v_src || ') e where e.user_id = $1' || v_seen
      into v_mine, v_me_metric, v_me_reached using p_viewer, p_week;
    if coalesce(v_mine, false) then
      execute 'select 1 + count(*)::integer from (' || v_src || ') e where true' || v_seen || v_ahead
        into v_me_pos using p_viewer, p_week, v_me_metric, v_me_reached;
      execute 'select e.metric from (' || v_src || ') e where true' || v_seen || v_ahead
           || ' order by ' || v_last || ' limit 1'
        into v_above using p_viewer, p_week, v_me_metric, v_me_reached;
    end if;
  end if;

  return jsonb_build_object(
    'ranked', v_ranked,
    'page', v_page,
    'me', case when coalesce(v_mine, false)
               then jsonb_build_object('user_id', p_viewer, 'pos', v_me_pos, 'metric', v_me_metric) end,
    'above', v_above);
end;
$$;

create or replace function public.leaderboard_page(
  p_board  text,
  p_viewer uuid,
  p_after  integer default 0,
  p_limit  integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  v_week  date := public.hunt_week_start(v_now);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_after integer := greatest(coalesce(p_after, 0), 0);
  v_rank  jsonb;
  v_page  jsonb;
  v_me    jsonb;
  v_ids   uuid[];
  v_out   jsonb;
begin
  if p_board not in ('weekly', 'all_time', 'best_hunt') then
    raise exception 'unknown board %', p_board;
  end if;

  v_rank := public.leaderboard_rank(p_board, p_viewer, v_week, v_after, v_limit);
  v_page := v_rank -> 'page';
  v_me   := nullif(v_rank -> 'me', 'null'::jsonb);

  -- Anyone about to be shown has an identity row (and so a public handle).
  -- Looked at first, so an ordinary read writes nothing.
  select coalesce(array_agg((e ->> 'user_id')::uuid), '{}'::uuid[]) into v_ids
    from jsonb_array_elements(v_page || case when v_me is null then '[]'::jsonb else jsonb_build_array(v_me) end) e;
  if exists (select 1 from unnest(v_ids) u(id)
              where not exists (select 1 from public.leaderboard_identity i where i.user_id = u.id)) then
    insert into public.leaderboard_identity (user_id)
    select distinct u.id from unnest(v_ids) u(id)
    on conflict (user_id) do nothing;
  end if;

  with shown as (
    select s.user_id, s.pos, s.metric, true as on_page
      from jsonb_to_recordset(v_page) as s(user_id uuid, pos integer, metric integer)
    union all
    -- The viewer, when they are ranked but not on this page.
    select m.user_id, m.pos, m.metric, false
      from jsonb_to_record(coalesce(v_me, '{}'::jsonb)) as m(user_id uuid, pos integer, metric integer)
     where v_me is not null
       and not exists (select 1 from jsonb_to_recordset(v_page) as s(user_id uuid) where s.user_id = m.user_id)
  ),
  described as (
    select s.user_id, s.pos, s.metric, i.public_id,
           case when i.name_hidden then null else i.public_name end   as name,
           case when i.avatar_hidden then null else i.avatar_url end as avatar,
           coalesce(x.total_xp, 0) as total_xp,
           (f.user_id is not null) as founding,
           -- The profile changed since the name or picture was last checked, or a
           -- check is still waiting: the server should look again.
           (i.name_source is distinct from (coalesce(p.display_name, '') || E'\n' || coalesce(p.username, ''))
            or coalesce(i.avatar_source, '') is distinct from coalesce(p.avatar_url, '')
            or i.name_status = 'pending' or i.avatar_status = 'pending') as stale,
           s.on_page
      from shown s
      join public.leaderboard_identity i on i.user_id = s.user_id
      left join public.profiles p on p.id = s.user_id
      left join public.xp_profiles x on x.user_id = s.user_id
      left join public.founding_hunters f on f.user_id = s.user_id
  )
  select jsonb_build_object(
    'board', p_board,
    'now', v_now,
    'week_start', v_week,
    'week_ends_at', ((v_week + 7)::timestamp at time zone 'America/Los_Angeles'),
    'ranked', coalesce((v_rank ->> 'ranked')::integer, 0),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(d) - 'on_page' order by d.pos) from described d where d.on_page), '[]'::jsonb),
    'me', (select to_jsonb(d) - 'on_page' from described d where v_me is not null and d.user_id = p_viewer),
    'above_metric', case when v_me is not null then (v_rank ->> 'above')::integer end
  ) into v_out;

  return v_out;
end;
$$;

-- ── 8. Report a name, a picture or suspected cheating ───────────────────────
-- Three different accounts reporting the same picture (or name) hide it until
-- you review it. Cheating reports never hide anything by themselves.
create or replace function public.report_profile(
  p_reporter  uuid,
  p_public_id uuid,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target  uuid;
  v_cleared timestamptz;
  v_count   integer;
  v_hidden  boolean := false;
  v_new     boolean;
begin
  if p_reason not in ('photo', 'name', 'cheating') then
    return jsonb_build_object('status', 'bad_reason');
  end if;
  select i.user_id into v_target from public.leaderboard_identity i where i.public_id = p_public_id;
  if v_target is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_target = p_reporter then return jsonb_build_object('status', 'self'); end if;

  -- One account cannot flood the queue.
  if (select count(*) from public.profile_reports r
       where r.reporter_id = p_reporter and r.created_at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.profile_reports (reporter_id, target_id, reason)
  values (p_reporter, v_target, p_reason)
  on conflict (reporter_id, target_id, reason) do nothing;
  get diagnostics v_count = row_count;
  v_new := v_count > 0;

  if p_reason in ('photo', 'name') then
    select case when p_reason = 'photo' then i.avatar_cleared_at else i.name_cleared_at end
      into v_cleared from public.leaderboard_identity i where i.user_id = v_target;
    select count(distinct r.reporter_id) into v_count from public.profile_reports r
     where r.target_id = v_target and r.reason = p_reason and r.status = 'open'
       and r.created_at > coalesce(v_cleared, 'epoch'::timestamptz);
    if v_count >= 3 then
      v_hidden := true;
      if p_reason = 'photo' then
        update public.leaderboard_identity set avatar_hidden = true, updated_at = now() where user_id = v_target;
      else
        update public.leaderboard_identity set name_hidden = true, updated_at = now() where user_id = v_target;
      end if;
    end if;
  end if;

  return jsonb_build_object('status', case when v_new then 'reported' else 'already' end, 'hidden', v_hidden);
end;
$$;

-- ── 9. Block and unblock ────────────────────────────────────────────────────
create or replace function public.set_user_block(
  p_blocker   uuid,
  p_public_id uuid,
  p_blocked   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  select i.user_id into v_target from public.leaderboard_identity i where i.public_id = p_public_id;
  if v_target is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_target = p_blocker then return jsonb_build_object('status', 'self'); end if;
  if p_blocked then
    if (select count(*) from public.user_blocks b where b.blocker_id = p_blocker) >= 500 then
      return jsonb_build_object('status', 'limit');
    end if;
    insert into public.user_blocks (blocker_id, blocked_id) values (p_blocker, v_target)
      on conflict (blocker_id, blocked_id) do nothing;
    return jsonb_build_object('status', 'blocked');
  end if;
  delete from public.user_blocks where blocker_id = p_blocker and blocked_id = v_target;
  return jsonb_build_object('status', 'unblocked');
end;
$$;

-- Who this account has blocked, as other people see them (for the unblock list).
create or replace function public.blocked_users(p_blocker uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'public_id', i.public_id,
           'name', case when i.name_hidden then null else i.public_name end,
           'avatar', case when i.avatar_hidden then null else i.avatar_url end)
         order by b.created_at desc), '[]'::jsonb)
    from public.user_blocks b
    join public.leaderboard_identity i on i.user_id = b.blocked_id
   where b.blocker_id = p_blocker;
$$;

-- ── 10. Founder controls (run these yourself, in this SQL editor) ───────────
-- Take an account off every board (or put it back). XP is not touched.
create or replace function public.leaderboard_set_excluded(p_user_id uuid, p_excluded boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.xp_profiles
     set leaderboard_status = case when p_excluded then 'excluded' else 'normal' end
   where user_id = p_user_id;
  if not found then return 'No XP profile for that account (nothing to change).'; end if;
  return case when p_excluded then 'Excluded from all leaderboards.' else 'Back on the leaderboards.' end;
end;
$$;

-- Review a reported PICTURE.  p_ok = true: it is fine, show it again, and the
-- reports so far stop counting.  p_ok = false: remove it for good (the default
-- picture shows until they upload a different one).
create or replace function public.leaderboard_review_avatar(p_user_id uuid, p_ok boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update public.leaderboard_identity
       set avatar_hidden = false, avatar_cleared_at = now(), updated_at = now() where user_id = p_user_id;
    update public.profile_reports set status = 'dismissed'
     where target_id = p_user_id and reason = 'photo' and status = 'open';
    return 'Picture cleared and showing again.';
  end if;
  update public.leaderboard_identity
     set avatar_hidden = true, avatar_status = 'rejected', avatar_url = null, updated_at = now() where user_id = p_user_id;
  update public.profile_reports set status = 'actioned'
   where target_id = p_user_id and reason = 'photo' and status = 'open';
  return 'Picture removed. The default picture shows until they upload a different one.';
end;
$$;

-- Review a reported NAME. Same idea: true = fine, false = show "Hunter" until they change it.
create or replace function public.leaderboard_review_name(p_user_id uuid, p_ok boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update public.leaderboard_identity
       set name_hidden = false, name_cleared_at = now(), updated_at = now() where user_id = p_user_id;
    update public.profile_reports set status = 'dismissed'
     where target_id = p_user_id and reason = 'name' and status = 'open';
    return 'Name cleared and showing again.';
  end if;
  update public.leaderboard_identity
     set name_hidden = true, name_status = 'rejected', public_name = null, updated_at = now() where user_id = p_user_id;
  update public.profile_reports set status = 'actioned'
   where target_id = p_user_id and reason = 'name' and status = 'open';
  return 'Name removed. They show as "Hunter" until they change it.';
end;
$$;

-- Close cheating reports about an account once you have looked.
create or replace function public.leaderboard_close_cheating_reports(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  update public.profile_reports set status = 'dismissed'
   where target_id = p_user_id and reason = 'cheating' and status = 'open';
  select 'Cheating reports closed.'::text;
$$;

-- Everything waiting for you, most-reported first.
create or replace view public.leaderboard_open_reports
with (security_invoker = true) as
select r.target_id as user_id, p.username, p.display_name, r.reason,
       count(distinct r.reporter_id) as reporters,
       min(r.created_at) as first_report, max(r.created_at) as last_report,
       case r.reason when 'photo' then i.avatar_hidden when 'name' then i.name_hidden else false end as hidden_now,
       case r.reason when 'photo' then p.avatar_url else null end as picture
  from public.profile_reports r
  left join public.profiles p on p.id = r.target_id
  left join public.leaderboard_identity i on i.user_id = r.target_id
 where r.status = 'open'
 group by r.target_id, p.username, p.display_name, r.reason, i.avatar_hidden, i.name_hidden, p.avatar_url
 order by count(distinct r.reporter_id) desc, max(r.created_at) desc;
revoke all on public.leaderboard_open_reports from anon, authenticated;

-- ── 11. A public bucket for moderated profile pictures ──────────────────────
-- Only the server writes here (no upload policy for app users). Files are small
-- re-encoded copies under random names, so a link says nothing about whose it is.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('public-avatars', 'public-avatars', true)
      on conflict (id) do nothing;
  end if;
end $$;

-- ── 12. App users can call none of this ─────────────────────────────────────
revoke all on function public.leaderboard_on_hunt() from public, anon, authenticated;
revoke all on function public.leaderboard_page(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.leaderboard_rank(text, uuid, date, integer, integer) from public, anon, authenticated;
revoke all on function public.report_profile(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_user_block(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.blocked_users(uuid) from public, anon, authenticated;
revoke all on function public.leaderboard_set_excluded(uuid, boolean) from public, anon, authenticated;
revoke all on function public.leaderboard_review_avatar(uuid, boolean) from public, anon, authenticated;
revoke all on function public.leaderboard_review_name(uuid, boolean) from public, anon, authenticated;
revoke all on function public.leaderboard_close_cheating_reports(uuid) from public, anon, authenticated;
grant execute on function public.leaderboard_page(text, uuid, integer, integer) to service_role;
grant execute on function public.report_profile(uuid, uuid, text) to service_role;
grant execute on function public.set_user_block(uuid, uuid, boolean) to service_role;
grant execute on function public.blocked_users(uuid) to service_role;
grant select, insert, update, delete on public.leaderboard_weekly, public.leaderboard_best_hunt,
  public.leaderboard_identity, public.profile_reports, public.user_blocks to service_role;
-- The report counter: closed to app users like its table.
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.profile_reports', 'id'));
end $$;

commit;

-- ── Check it worked ─────────────────────────────────────────────────────────
-- Should list 5 tables. The second query shows the All-Time board as stored.
select tablename from pg_tables
 where schemaname = 'public'
   and tablename in ('leaderboard_weekly', 'leaderboard_best_hunt', 'leaderboard_identity', 'profile_reports', 'user_blocks')
 order by 1;

select public.leaderboard_page('all_time', null, 0, 10);

-- ── How to use the founder controls ─────────────────────────────────────────
--   select * from public.leaderboard_open_reports;                      -- what is waiting
--   select public.leaderboard_review_avatar('<user id>', true);         -- picture is fine
--   select public.leaderboard_review_avatar('<user id>', false);        -- remove the picture
--   select public.leaderboard_review_name('<user id>', false);          -- remove the name
--   select public.leaderboard_set_excluded('<user id>');                -- off every board
--   select public.leaderboard_set_excluded('<user id>', false);         -- back on
--   select public.leaderboard_close_cheating_reports('<user id>');      -- looked, nothing to do