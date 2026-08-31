-- ============================================================================
-- transfer_subscription_ownership
--
-- Moves an ACTIVE subscription period -- including its consumed usage -- from
-- one FlipStart account to another, atomically.
--
-- ── Why the usage moves with it ─────────────────────────────────────────────
-- A RevenueCat account transfer is NOT a new billing period. If the
-- destination started at a fresh allowance, the allowance would be farmable:
-- spend scans, create a new FlipStart account, Restore Purchases, get a full
-- allowance again, repeat forever off one Apple subscription.
--
-- So subscription_scans_used travels with subscription_period_start. A user who
-- had spent 1 of 300 still has 299 after the transfer, not 300.
--
-- ── What must NOT move ──────────────────────────────────────────────────────
-- free_scans_used and pack_scan_balance are properties of the ACCOUNT, not of
-- the subscription. Free scans are a per-account lifetime grant; pack scans
-- were bought with money by a specific account and never expire. Neither is
-- touched here, for either side.
--
-- ── Atomicity ───────────────────────────────────────────────────────────────
-- One transaction, with rows locked in a deterministic order. There is no
-- window in which both accounts hold a usable subscription bucket, and two
-- concurrent transfers cannot deadlock against each other.
--
-- Replay protection lives one layer up, in claim_revenuecat_event(): a
-- redelivered TRANSFER never reaches this function. This function is also
-- naturally idempotent on a second call, because after the first the sources
-- no longer hold a subscription and it becomes a no-op.
-- ============================================================================

-- An earlier 2-argument version may exist. Postgres treats a different
-- signature as an OVERLOAD rather than a replacement, and PostgREST could then
-- resolve the wrong one -- the permissive version this hardening removes.
drop function if exists public.transfer_subscription_ownership(uuid[], uuid);

create or replace function public.transfer_subscription_ownership(
  p_from_user_ids uuid[],
  p_to_user_id    uuid,
  -- The subscription RevenueCat has just confirmed the destination owns.
  -- A source is eligible ONLY if its row already represents this exact period.
  p_product_id    text,
  p_period_start  timestamptz
)
returns table(
  transferred            boolean,
  source_user_id         uuid,
  moved_product_id       text,
  moved_period_start     timestamptz,
  moved_period_end       timestamptz,
  moved_scans_used       integer,
  sources_cleared        integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_src            public.account_usage;
  v_cleared        integer := 0;
  v_lock_ids       uuid[];
  v_match_count    integer := 0;
  v_matched_used   integer := 0;
begin
  -- The destination must exist before anything is locked or moved.
  insert into public.account_usage (user_id) values (p_to_user_id)
    on conflict (user_id) do nothing;

  /**
   * Deterministic lock order.
   *
   * Every id involved -- sources and destination -- sorted ascending, so two
   * concurrent transfers touching overlapping accounts always take locks in the
   * same sequence and cannot deadlock.
   */
  select array_agg(uid order by uid) into v_lock_ids
  from (
    select unnest(coalesce(p_from_user_ids, '{}'::uuid[])) as uid
    union
    select p_to_user_id
  ) s;

  perform 1 from public.account_usage
   where user_id = any(v_lock_ids)
   order by user_id
     for update;

  /**
   * Choose the source by SUBSCRIPTION IDENTITY, never by array position and
   * never merely by "has the latest end date".
   *
   * transferred_from may carry several identified App User IDs and aliases, any
   * of which could hold an unrelated subscription of their own. Moving quota
   * from whichever happened to expire last would rob a different subscriber.
   *
   * So a row is eligible only if it already represents the EXACT period the
   * destination has just been confirmed to own: same product, same period_start.
   * That pins the counter we move to the period it was actually consumed under.
   *
   * The destination is excluded -- a self-transfer must not wipe the row it is
   * meant to populate.
   */
  select count(*), max(subscription_scans_used)
    into v_match_count, v_matched_used
    from public.account_usage
   where user_id = any(coalesce(p_from_user_ids, '{}'::uuid[]))
     and user_id <> p_to_user_id
     and subscription_product_id   = p_product_id
     and subscription_period_start = p_period_start;

  select * into v_src
    from public.account_usage
   where user_id = any(coalesce(p_from_user_ids, '{}'::uuid[]))
     and user_id <> p_to_user_id
     and subscription_product_id   = p_product_id
     and subscription_period_start = p_period_start
   order by subscription_scans_used desc, user_id
   limit 1;

  if v_src.user_id is null then
    /**
     * No source row represents this subscription period.
     *
     * Either the TRANSFER already applied, or the previous owner was an
     * anonymous RevenueCat id with no FlipStart row, or the arrays named users
     * whose subscriptions are simply not this one.
     *
     * FAIL CLOSED. Reported, never raised, and critically the destination is
     * NOT touched: no product is written and no counter is initialised, so this
     * function can never mint a fresh allowance as a fallback. The caller
     * decides what to do with an unmatched transfer.
     */
    return query select false, null::uuid, null::text, null::timestamptz,
                        null::timestamptz, null::integer, 0;
    return;
  end if;

  /**
   * Duplicate stale owners for the SAME period.
   *
   * Deterministic and conservative: take the HIGHEST subscription_scans_used
   * among them (the ORDER BY above), never the sum and never the lowest.
   *
   * Summing would charge the user twice for scans consumed once. Taking the
   * lowest would be farmable -- leave a stale low-usage row around and transfer
   * through it to claw back allowance. The highest is the only figure that is
   * certainly true: at least that many were spent under this period.
   */
  if v_match_count > 1 then
    raise notice 'transfer: % source rows match period %, using highest usage %',
      v_match_count, p_period_start, v_matched_used;
  end if;

  /**
   * Move the period AND its consumed usage together.
   *
   * subscription_scans_used is copied verbatim. That single column is what
   * makes the allowance non-farmable.
   *
   * free_scans_used and pack_scan_balance are absent from this UPDATE by
   * design -- the destination keeps its own.
   */
  update public.account_usage set
    subscription_product_id   = v_src.subscription_product_id,
    subscription_period_start = v_src.subscription_period_start,
    subscription_period_end   = v_src.subscription_period_end,
    subscription_scans_used   = v_src.subscription_scans_used,
    updated_at                = now()
  where user_id = p_to_user_id;

  /**
   * Clear EVERY source, not just the one we copied from.
   *
   * If two old rows somehow both held the subscription, leaving either active
   * would recreate the exact duplication this function exists to prevent.
   *
   * Again: free_scans_used and pack_scan_balance are untouched. The old account
   * keeps its own free allowance and any packs it paid for.
   */
  with cleared as (
    update public.account_usage set
      subscription_product_id   = null,
      subscription_period_start = null,
      subscription_period_end   = null,
      subscription_scans_used   = 0,
      updated_at                = now()
    where user_id = any(coalesce(p_from_user_ids, '{}'::uuid[]))
      and user_id <> p_to_user_id
      -- Only stale owners OF THIS SUBSCRIPTION. A user named in the array who
      -- holds a DIFFERENT subscription of their own keeps it; revoking that
      -- would be the mirror image of the duplication bug.
      and subscription_product_id   = p_product_id
      and subscription_period_start = p_period_start
    returning 1
  )
  select count(*)::integer into v_cleared from cleared;

  return query select true, v_src.user_id, v_src.subscription_product_id,
                      v_src.subscription_period_start, v_src.subscription_period_end,
                      v_src.subscription_scans_used, v_cleared;
end
$function$;

-- Callable only by the service role, matching the other monetization RPCs.
revoke all on function public.transfer_subscription_ownership(uuid[], uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.transfer_subscription_ownership(uuid[], uuid, text, timestamptz) to service_role;