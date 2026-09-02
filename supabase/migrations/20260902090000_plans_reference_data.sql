-- ============================================================================
-- Plans — the three pricing tiers, as reference data rather than seed data.
-- ============================================================================
--
-- These rows were in `supabase/seed.sql`, which was the wrong file for them.
-- Seeds only run on `supabase db reset`, which is a local command, so nothing
-- in seed.sql ever reaches a deployed database. That is correct for the demo
-- agencies and their fake callers, and wrong for these: `plans` is real
-- product configuration, the prices in spec §1, and the application needs it
-- everywhere it runs.
--
-- Without these rows a fresh production database looks like it works right up
-- until someone opens the admin console. "New agency" offers only "No plan
-- yet", the plan column on the agency list reads "No plan" for everyone, and
-- there is no way to put a client on a tier. Nothing errors, so the gap is
-- easy to ship and confusing to diagnose.
--
-- REFERENCE DATA vs SEED DATA, since the line matters for anything added
-- later: reference data is rows the product itself is defined in terms of, and
-- it belongs in a migration. Seed data is example content that makes a local
-- database pleasant to develop against, and it belongs in seed.sql. If a
-- production feature breaks without a row, that row is reference data.
--
-- The ids are fixed rather than generated. They are foreign keys from
-- seed.sql's tenants, so a `gen_random_uuid()` default here would break every
-- local reset. Fixed ids also make the rows the same in every environment,
-- which is what lets a bug report name a plan id and have it mean something.
--
-- `on conflict do nothing` keeps this safe to re-run and safe to apply to a
-- database that already has the rows from an earlier seed. `name` is unique,
-- so a conflict on either the id or the name is caught.
-- ============================================================================

insert into plans (id, name, monthly_price_cents, included_minutes, overage_cents_per_min) values
  ('99999999-0000-0000-0000-000000000001', 'starter', 19900,  800,  16),
  ('99999999-0000-0000-0000-000000000002', 'growth',  49900, 2500,  14),
  ('99999999-0000-0000-0000-000000000003', 'scale',  124000, 6000,  11)
on conflict (id) do nothing;
