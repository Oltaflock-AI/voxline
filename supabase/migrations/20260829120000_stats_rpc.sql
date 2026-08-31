-- ============================================================================
-- Server-side aggregation for the Overview and the Calls filter chips.
--
-- WHY THIS EXISTS — a real bug, not a refactor.
--
-- Both screens used to fetch raw call rows and tally them in JavaScript.
-- PostgREST caps every response at `max_rows` (1000, see supabase/config.toml),
-- and it does so SILENTLY: no error, no truncation flag, just fewer rows.
--
-- Past 1000 calls the effects were:
--   * Calls tab: chip totals froze at 1000 while the sidebar (which used a
--     real COUNT) said 1369 — two different numbers on the same screen.
--   * Overview: "Calls handled" understated, and because rows came back
--     oldest-first, the newest days were the ones dropped — the volume chart
--     showed 0 calls for today.
--
-- Spec §8 targets "realistic volume, thousands of calls", and a Scale tenant
-- (6,000 included minutes ≈ 1,500 calls/month) crosses 1000 inside the
-- 14-day comparison window. So this was guaranteed to hit a real pilot.
--
-- Aggregating in Postgres returns at most 14 × 4 = 56 rows instead of
-- thousands, which fixes the correctness bug and the performance one together.
--
-- SECURITY INVOKER (the default) is load-bearing: these run as the calling
-- user, so the RLS policy on `calls` still applies and a tenant can only ever
-- aggregate its own rows. Do not add SECURITY DEFINER here — it would turn
-- both functions into a cross-tenant data leak.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-day, per-outcome rollup for a date range.
--
-- Buckets by UTC day to match the application (see the note on startOfDay in
-- src/lib/metrics.ts). Both share the same open question: a per-tenant
-- timezone would be more correct than UTC for an agency abroad.
-- ---------------------------------------------------------------------------
create or replace function call_stats_daily(
  p_tenant_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns table (
  bucket        date,
  outcome       call_outcome,
  n             bigint,
  total_seconds bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (c.started_at at time zone 'UTC')::date as bucket,
    c.outcome,
    count(*)                                as n,
    coalesce(sum(c.duration_seconds), 0)    as total_seconds
  from public.calls c
  where c.tenant_id = p_tenant_id
    and c.started_at >= p_from
    and c.started_at <  p_to
  group by 1, 2;
$$;

-- ---------------------------------------------------------------------------
-- All-time totals per outcome, for the Calls tab filter chips.
--
-- Deliberately not date-bounded: the chips describe the whole call log the
-- user is paging through, not a rolling window.
-- ---------------------------------------------------------------------------
create or replace function call_outcome_counts(p_tenant_id uuid)
returns table (
  outcome call_outcome,
  n       bigint
)
language sql
stable
set search_path = ''
as $$
  select c.outcome, count(*) as n
  from public.calls c
  where c.tenant_id = p_tenant_id
  group by 1;
$$;

revoke execute on function call_stats_daily(uuid, timestamptz, timestamptz) from public;
revoke execute on function call_outcome_counts(uuid) from public;
grant execute on function call_stats_daily(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function call_outcome_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ingestion hardening — two bugs found reviewing the Retell webhook.
-- ---------------------------------------------------------------------------

-- BUG 1: minutes were double-counted on retry.
--
-- The call row upserts idempotently on retell_call_id, but add_call_minutes()
-- did not. Retell retries on timeout, so a redelivered `call_ended` billed the
-- same call twice — silent over-billing that nothing in the UI would reveal.
--
-- This column is the idempotency key. The handler claims it with a conditional
-- UPDATE ... WHERE minutes_counted_at IS NULL, which only one caller can win.
alter table calls add column if not exists minutes_counted_at timestamptz;

-- BUG 2: two concurrent deliveries could both create a lead for one call.
--
-- The handler checked "does a lead already exist for this call" and then
-- inserted — a classic check-then-act race with nothing enforcing it. Two
-- webhook deliveries landing together both saw "no lead" and both inserted.
--
-- NOT a partial index, deliberately. The obvious version —
--   create unique index ... on leads (call_id) where call_id is not null
-- looks right (a lead may legitimately have no call: manual leads, Phase 2)
-- but breaks the upsert: `ON CONFLICT (call_id)` cannot use a partial index
-- unless the query restates the predicate, and the Supabase client does not
-- emit it. The insert fails with "no unique or exclusion constraint matching
-- the ON CONFLICT specification", and because lead creation is best-effort
-- (rule 5 in the handler) it fails *silently* — calls keep landing, leads
-- quietly stop appearing.
--
-- A plain unique index is both simpler and correct here: Postgres treats NULLs
-- as distinct, so any number of leads with call_id IS NULL still coexist.
create unique index if not exists leads_call_id_uniq
  on leads (call_id);
