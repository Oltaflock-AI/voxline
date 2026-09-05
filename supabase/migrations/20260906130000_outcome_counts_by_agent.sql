-- ============================================================================
-- Outcome chip counts, optionally scoped to one agent.
-- ============================================================================
--
-- The Calls tab is gaining an agent filter, because an agency can now have
-- several agents — Sarthak Singapore has one per property. The chips above the
-- list are counted by this function, and it only knew about tenants.
--
-- Left alone, the chips would keep showing tenant-wide totals while the list
-- below showed one agent's calls: "Voicemail 39" over a list of four. That is
-- exactly the two-numbers-for-the-same-thing bug this function was written to
-- fix in the first place — see the header of 20260829120000_stats_rpc.sql,
-- where tallying in JavaScript capped silently at PostgREST's 1000-row limit
-- and the chips summed to 1000 while the sidebar said 1369.
--
-- DROP THEN CREATE, not `create or replace`. Adding a defaulted parameter
-- changes the signature, so `create or replace` would leave BOTH functions in
-- place — and a one-argument call would then be ambiguous between them, which
-- Postgres reports as "function call_outcome_counts(uuid) is not unique". The
-- error names the call site, not this migration, so it reads like application
-- code broke.
--
-- SECURITY INVOKER is retained by omission, and it is load-bearing: this runs
-- as the calling user so RLS still applies. A SECURITY DEFINER version would
-- happily count another tenant's calls if the argument were wrong.
-- ============================================================================

drop function if exists call_outcome_counts(uuid);

create function call_outcome_counts(
  p_tenant_id      uuid,
  p_voice_agent_id uuid default null
)
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
    -- `is null or` rather than two functions: one plan, and the existing
    -- one-argument call sites keep working unchanged.
    and (p_voice_agent_id is null or c.voice_agent_id = p_voice_agent_id)
  group by 1;
$$;

revoke execute on function call_outcome_counts(uuid, uuid) from public;
grant  execute on function call_outcome_counts(uuid, uuid) to authenticated;
