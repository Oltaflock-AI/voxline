-- ============================================================================
-- add_call_minutes — spec §4 step 4, "increment the tenant's minutes for the
-- current billing period".
--
-- WHY THIS IS A FUNCTION AND NOT THREE QUERIES IN TYPESCRIPT.
--
-- The obvious version is: select the current period, add the minutes, update.
-- That is a lost-update race. Two calls ending at the same moment both read
-- 100.0, both write 104.0, and one call's minutes are gone. At a busy agency
-- that is silent under-billing, and nothing in the UI would ever show it.
--
-- `insert ... on conflict do update` with the arithmetic in the SET clause is
-- a single atomic statement. Postgres takes a row lock, so the second writer
-- reads the first writer's value. The unique constraint on
-- (tenant_id, period_start) is what makes the upsert possible.
-- ============================================================================

create or replace function add_call_minutes(
  p_tenant_id uuid,
  p_minutes numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', now())::date;
  v_end   date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;
begin
  insert into public.usage_periods (tenant_id, period_start, period_end, minutes_used)
  values (p_tenant_id, v_start, v_end, p_minutes)
  on conflict (tenant_id, period_start) do update
    set minutes_used = public.usage_periods.minutes_used + excluded.minutes_used;
end;
$$;

-- Callable only by the service role: this is the webhook's job, and letting a
-- logged-in client add minutes to their own account would be an odd thing to
-- allow. `revoke ... from public` also covers anon and authenticated.
revoke execute on function add_call_minutes(uuid, numeric) from public;
grant execute on function add_call_minutes(uuid, numeric) to service_role;

-- NOTE: the billing period here is a calendar month. When Stripe lands
-- (ticket S-3) the period must come from the subscription's actual billing
-- cycle instead, which for most tenants does not start on the 1st.
