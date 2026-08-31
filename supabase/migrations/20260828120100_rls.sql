-- ============================================================================
-- Voxline RLS policies — spec §5, §8.
--
-- Spec §8: "Tenant isolation ... This is the single most important requirement
-- in the project. A feature that ships without it is not shipped."
--
-- ---------------------------------------------------------------------------
-- HOW TO READ THIS FILE
-- ---------------------------------------------------------------------------
-- A policy is a WHERE clause Postgres silently welds onto every query against
-- the table, per role. If the row fails it, the row does not exist as far as
-- that user is concerned — no error, just absence. That is the point: the
-- attacker gets nothing to probe.
--
-- Four commands, and they take different clauses:
--   select / delete → USING       (which existing rows am I allowed to see)
--   insert          → WITH CHECK  (is the row I'm creating allowed)
--   update          → BOTH        (USING = may I touch it,
--                                  WITH CHECK = is it still legal afterwards)
--
-- Forgetting WITH CHECK on update is the classic hole: it lets a user take a
-- row they legitimately own and reassign its tenant_id to someone else's
-- tenant. USING passes (they owned it going in), and with no WITH CHECK
-- nothing checks the row on the way out.
--
-- `to authenticated` matters. Without it a policy also applies to `anon`,
-- the logged-out role. auth.uid() is null for anon, so the subquery returns
-- nothing and it happens to be safe here — but say what you mean.
--
-- The service-role key bypasses every policy below. That is why it is confined
-- to src/lib/supabase/admin.ts and never imported by client-reachable code.
-- ============================================================================


-- ===========================================================================
-- WORKED EXAMPLE 1 — memberships. The bootstrap table.
--
-- This one CANNOT use auth_tenant_ids(), because auth_tenant_ids() reads
-- memberships. It has to key off the user directly. Everything else in the
-- database hangs off this policy being right.
--
-- Read-only to clients: you don't get to add yourself to a tenant. Membership
-- changes go through admin code on the service role.
-- ===========================================================================
create policy memberships_select_own
  on memberships for select
  to authenticated
  using (user_id = (select auth.uid()));


-- ===========================================================================
-- WORKED EXAMPLE 2 — tenants. Keyed on `id`, not `tenant_id`.
--
-- Note the shape: `id in (select auth_tenant_ids())`. Every table below uses
-- `tenant_id in (...)` instead. Easy to copy the wrong one.
--
-- Also read-only: a client cannot create or rename a tenant.
-- ===========================================================================
create policy tenants_select_member
  on tenants for select
  to authenticated
  using (id in (select auth_tenant_ids()));


-- ===========================================================================
-- WORKED EXAMPLE 3 — calls. The standard tenant-owned table, in full.
--
-- Clients read calls. They never write them: rows come from the Retell webhook
-- running on the service role. No insert/update/delete policy = those are
-- denied, which is what we want.
-- ===========================================================================
create policy calls_select_tenant
  on calls for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));


-- ===========================================================================
-- WORKED EXAMPLE 4 — leads. The one table clients actually WRITE to
-- (dragging a card between stages). So it needs update with both clauses.
--
-- Read this pair carefully, it is the whole lesson:
--   using      → the lead I'm moving must already be in one of my tenants
--   with check → after my update it must STILL be in one of my tenants
-- Drop the second line and a user can move a lead into a competitor's board.
-- ===========================================================================
create policy leads_select_tenant
  on leads for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

create policy leads_update_tenant
  on leads for update
  to authenticated
  using      (tenant_id in (select auth_tenant_ids()))
  with check (tenant_id in (select auth_tenant_ids()));


-- ===========================================================================
-- YOUR TURN — the rest is the same pattern. Spec §5 says "every tenant-owned
-- table", so none of these can be skipped.
--
-- For each one, ask two questions:
--   1. Does a client need to READ it?   → select policy
--   2. Does a client need to WRITE it?  → insert/update, and remember WITH CHECK
--
-- Answers, so you're deciding the shape and not guessing the product:
--
--   voice_agents     read yes. write NO — spec §6.6, config changes are
--                    concierge, a bad config breaks a live phone line.
--   usage_periods    read yes (the usage bar). write no — billing writes it.
--   invoices         read yes (invoice history). write no — Stripe writes it.
--   change_requests  read yes AND insert yes — this is the "Request a change"
--                    modal. Insert needs WITH CHECK on tenant_id, and should
--                    also pin user_id = auth.uid() so a user cannot file a
--                    request as somebody else.
--   audit_log        read no, write no. Admin-only, service role. Leave it
--                    with RLS on and zero policies — that denies everyone.
--
--   profiles         special, like memberships: keyed on `id = auth.uid()`,
--                    not tenant. Users read and update their OWN row only
--                    (display_name, theme_pref). Needs select + update.
--   plans            special the other way: global reference data, no tenant
--                    column. Every authenticated user may read it, nobody
--                    writes it. `using (true)` is correct here — say why in a
--                    comment so the next reader knows it isn't an oversight.
--   platform_admins  read no, write no. Zero policies. is_platform_admin()
--                    is security definer, so it reads the table regardless.
-- ===========================================================================

-- TODO(adnan): voice_agents
create policy voice_agents_select_tenant
  on voice_agents for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

-- TODO(adnan): usage_periods
create policy usage_periods_select_tenant
  on usage_periods for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

-- TODO(adnan): invoices
create policy invoices_select_tenant
  on invoices for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

-- TODO(adnan): change_requests   -- select + insert
create policy change_requests_select_tenant
  on change_requests for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

create policy change_requests_insert_own
  on change_requests for insert
  to authenticated
  with check (
    tenant_id in (select auth_tenant_ids())
    and user_id = (select auth.uid())
  );

-- TODO(adnan): profiles          -- select + update, keyed on id = auth.uid()
create policy profiles_select_own
  on profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- plans: global price list, not tenant data — every authenticated user may
-- read it, nobody writes it.
create policy plans_select_all
  on plans for select
  to authenticated
  using (true);

-- audit_log and platform_admins: intentionally no policies. Do not add any.

-- ===========================================================================
-- After you write them, prove it. Impersonate a seeded user:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
--                       'role', 'authenticated')::text, true);
--   set local role authenticated;
--
--   select count(*) from calls;        -- Elena is Wanderlux-only: 241, never 337
--   select count(*) from tenants;      -- 1
--   select count(*) from memberships;  -- 1
--   commit;
--
-- THE `begin;` IS NOT OPTIONAL. The third argument to set_config is
-- `is_local` = true, meaning the setting lasts until the end of the current
-- transaction. Run these statements outside a transaction and psql autocommits
-- each one, so the claim is gone by the next line, auth.uid() returns null,
-- and every count comes back 0 — which looks exactly like watertight isolation.
-- A test that passes because nothing is configured is worse than no test.
--
-- Seeded users to test with (see supabase/seed.sql):
--   sofia  aaaa… both tenants   — should see 337 calls
--   marco  bbbb… Blue Harbor    — should see  96
--   elena  cccc… Wanderlux      — should see 241
--
-- The automated version of this is the CI isolation test in Block E, and it is
-- the one thing spec §9 says can never be cut.
-- ===========================================================================
