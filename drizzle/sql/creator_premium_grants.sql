-- drizzle/sql/creator_premium_grants.sql
--
-- Free Pro for accounts you choose (UGC creators).
--
-- Run this whole file ONCE in the Supabase SQL editor. After that, granting
-- or revoking is one line (bottom of this file).
--
-- What a grant does:
--   * the account is Pro immediately, with the Monthly allowance
--   * the allowance renews every 30 days for as long as the grant lasts
--     (the server rolls the period over; needs the matching server deploy)
--   * a later "Restore purchases" never removes it
--   * if they BUY Pro, their real subscription takes priority; when it ends,
--     the grant takes over again
--   * it never counts as revenue (there is no purchase)
--
-- Only you can use it: the table has row-level security with no policies, and
-- the two functions can't be called by app users (anon / authenticated).
--
-- Safe to run more than once.

-- ── 1. Who has a grant ──────────────────────────────────────────────────────
create table if not exists public.premium_grants (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  ends_at     timestamptz,          -- null = until you revoke it
  revoked_at  timestamptz,
  note        text                  -- e.g. the creator's handle
);

alter table public.premium_grants enable row level security;
revoke all on public.premium_grants from anon, authenticated;

-- ── 2. Give Pro ─────────────────────────────────────────────────────────────
-- p_months: how long. Leave it out (or null) for "until I revoke it".
create or replace function public.grant_premium(
  p_user_id uuid,
  p_months  integer default null,
  p_note    text    default null
)
returns table (user_id uuid, status text, pro_until timestamptz, grant_ends timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_now  timestamptz := now();
  v_end  timestamptz := case when p_months is null then null
                             else now() + make_interval(months => p_months) end;
  v_period_end timestamptz := least(now() + interval '30 days', coalesce(v_end, 'infinity'::timestamptz));
  v_paid boolean;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'No FlipStart account has the id %', p_user_id;
  end if;
  if p_months is not null and p_months < 1 then
    raise exception 'p_months must be 1 or more (or null for no end date)';
  end if;

  insert into public.premium_grants as g (user_id, granted_at, ends_at, revoked_at, note)
  values (p_user_id, v_now, v_end, null, p_note)
  on conflict (user_id) do update
    set granted_at = v_now, ends_at = excluded.ends_at, revoked_at = null,
        note = coalesce(excluded.note, g.note);

  -- Never overwrite a real, running paid subscription.
  select exists (
    select 1 from public.account_usage a
    where a.user_id = p_user_id
      and a.subscription_product_id is not null
      and a.subscription_product_id <> 'flipstart_creator_grant'
      and a.subscription_period_end > v_now
  ) into v_paid;

  if v_paid then
    return query select p_user_id, 'already paying — grant saved, starts when their subscription ends'::text,
                        (select a.subscription_period_end from public.account_usage a where a.user_id = p_user_id), v_end;
    return;
  end if;

  if not exists (select 1 from public.account_usage a where a.user_id = p_user_id) then
    insert into public.account_usage (user_id) values (p_user_id);
  end if;

  update public.account_usage a
     set subscription_product_id   = 'flipstart_creator_grant',
         subscription_period_start = v_now,
         subscription_period_end   = v_period_end,
         subscription_scans_used   = 0
   where a.user_id = p_user_id;

  return query select p_user_id, 'Pro now'::text, v_period_end, v_end;
end;
$$;

-- ── 3. Take it back ─────────────────────────────────────────────────────────
-- Ends a grant immediately. Never touches a real paid subscription.
create or replace function public.revoke_premium(p_user_id uuid)
returns table (user_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  update public.premium_grants g set revoked_at = now()
   where g.user_id = p_user_id and g.revoked_at is null;

  update public.account_usage a
     set subscription_product_id   = null,
         subscription_period_start = null,
         subscription_period_end   = null,
         subscription_scans_used   = 0
   where a.user_id = p_user_id
     and a.subscription_product_id = 'flipstart_creator_grant';

  return query select p_user_id, 'grant revoked'::text;
end;
$$;

-- App users must never be able to call these through the API.
revoke execute on function public.grant_premium(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.revoke_premium(uuid) from public, anon, authenticated;

-- ── How to use it (run one line at a time) ──────────────────────────────────
--
-- Give Pro until you revoke it:
--   select * from grant_premium('PASTE-USER-ID-HERE', null, 'creator handle');
--
-- Give Pro for 3 months:
--   select * from grant_premium('PASTE-USER-ID-HERE', 3, 'creator handle');
--
-- Take it back:
--   select * from revoke_premium('PASTE-USER-ID-HERE');
--
-- See everyone with a grant:
--   select g.user_id, g.note, g.granted_at, g.ends_at, g.revoked_at,
--          a.subscription_period_end as pro_until, a.subscription_scans_used as scans_this_period
--     from premium_grants g left join account_usage a on a.user_id = g.user_id
--    order by g.granted_at desc;