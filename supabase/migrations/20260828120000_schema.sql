-- ============================================================================
-- Voxline schema — spec §5.
--
-- Tables, enums, indexes, and RLS *enabled but unpoliced*.
-- Policies live in the next migration (20260828120100_rls.sql) on purpose:
-- enabling RLS with zero policies denies everything, which is the safe state
-- to be in between these two migrations.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
--
-- Native enums rather than CHECK constraints: they give the app real type
-- safety and Postgres rejects a bad value at write time. Cost: adding a value
-- later needs `alter type ... add value`, which cannot run inside a
-- transaction block. That is the open question on calls.outcome (no bucket for
-- "real person, busy, call back later") — decide it before data lands.
-- ---------------------------------------------------------------------------
create type tenant_status  as enum ('active', 'paused', 'churned');
create type membership_role as enum ('owner', 'member');
create type plan_name      as enum ('starter', 'growth', 'scale');
create type agent_status   as enum ('live', 'paused');
create type call_outcome   as enum ('inquiry_captured', 'quote_requested', 'voicemail', 'not_a_fit');
create type lead_stage     as enum ('new_inquiry', 'quoted', 'booked', 'traveling');
create type invoice_status as enum ('paid', 'open', 'void');
create type change_request_status as enum ('open', 'done');

-- ---------------------------------------------------------------------------
-- plans — global, not tenant-owned. Readable by everyone, written by admins.
-- ---------------------------------------------------------------------------
create table plans (
  id                    uuid primary key default gen_random_uuid(),
  name                  plan_name not null unique,
  monthly_price_cents   integer not null,
  included_minutes      integer not null,
  overage_cents_per_min integer not null,
  stripe_price_ids      jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tenants — one row per travel agency. The root of every isolation rule.
-- ---------------------------------------------------------------------------
create table tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  initials   text not null,
  plan_id    uuid references plans(id),
  status     tenant_status not null default 'active',
  branding   jsonb not null default '{}'::jsonb,  -- Phase 3 white label: logo_url, accent_hex
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users. Supabase owns auth.users; app-level user
-- data that we control lives here.
-- ---------------------------------------------------------------------------
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  avatar_initials text,
  theme_pref      text not null default 'system' check (theme_pref in ('system', 'dark', 'light')),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memberships — which user can see which tenant. Drives the tenant switcher
-- AND every RLS policy in the database.
-- ---------------------------------------------------------------------------
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role       membership_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

-- ---------------------------------------------------------------------------
-- platform_admins — Oltaflock staff. Spec §6.7. Gates /admin.
-- ---------------------------------------------------------------------------
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- voice_agents — the Retell agent wired to a tenant's phone line.
-- retell_agent_id is how an inbound webhook resolves its tenant.
-- ---------------------------------------------------------------------------
create table voice_agents (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id) on delete cascade,
  retell_agent_id             text unique,
  name                        text not null,
  phone_number                text,
  voice_desc                  text,
  languages                   text[] not null default '{}',
  business_hours              jsonb not null default '{}'::jsonb,
  after_hours_behavior        text,
  escalation_number           text,
  qualification_questions     text[] not null default '{}',
  status                      agent_status not null default 'paused',
  crm_connection              jsonb not null default '{}'::jsonb,
  recording_retention_months  integer not null default 12,
  created_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- calls — the product. One row per handled call, written by the Retell webhook.
--
-- retell_call_id is UNIQUE because the handler upserts on it: Retell retries,
-- and a retry must update the existing row rather than insert a duplicate.
-- That single constraint is what makes ingestion idempotent.
-- ---------------------------------------------------------------------------
create table calls (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  voice_agent_id   uuid references voice_agents(id) on delete set null,
  retell_call_id   text not null unique,
  caller_name      text,
  caller_phone     text,
  started_at       timestamptz not null default now(),
  duration_seconds integer not null default 0,
  outcome          call_outcome,
  recording_path   text,                                -- storage object path, NOT a URL
  transcript       jsonb not null default '[]'::jsonb,  -- [{speaker, text, ts}]
  analysis         jsonb not null default '{}'::jsonb,  -- destination, dates, party_size, budget, occasion, notes
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- leads — the trip pipeline. Created automatically when a call qualifies.
-- position orders cards within a stage column.
-- ---------------------------------------------------------------------------
create table leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  call_id     uuid references calls(id) on delete set null,
  name        text not null,
  summary     text,
  stage       lead_stage not null default 'new_inquiry',
  details     jsonb not null default '{}'::jsonb,
  tags        text[] not null default '{}',
  assigned_to uuid references auth.users(id) on delete set null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- usage_periods — minutes consumed per billing period, reported to Stripe.
-- ---------------------------------------------------------------------------
create table usage_periods (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  minutes_used       numeric(10, 2) not null default 0,
  stripe_reported_at timestamptz,
  created_at         timestamptz not null default now(),
  unique (tenant_id, period_start)
);

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  stripe_invoice_id text unique,
  number            text,
  period_label      text,
  minutes           numeric(10, 2) not null default 0,
  amount_cents      integer not null default 0,
  status            invoice_status not null default 'open',
  pdf_url           text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- change_requests — spec §6.6. Clients do not edit agent config directly;
-- a bad config breaks a live phone line. They ask, an admin does it.
-- ---------------------------------------------------------------------------
create table change_requests (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  message    text not null,
  status     change_request_status not null default 'open',
  created_at timestamptz not null default now()
);

create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes — spec §5 names these four as day-one. The others follow the
-- foreign keys the app actually joins on.
-- ---------------------------------------------------------------------------
create index calls_tenant_started_idx   on calls (tenant_id, started_at desc);
create index leads_tenant_stage_pos_idx on leads (tenant_id, stage, position);
create index memberships_user_idx       on memberships (user_id);
-- calls(retell_call_id) and memberships(user_id, tenant_id) are already unique-indexed above.

create index voice_agents_tenant_idx    on voice_agents (tenant_id);
create index leads_call_idx             on leads (call_id);
create index change_requests_tenant_idx on change_requests (tenant_id, status);
create index usage_periods_tenant_idx   on usage_periods (tenant_id, period_start desc);
create index invoices_tenant_idx        on invoices (tenant_id, created_at desc);
create index audit_log_tenant_idx       on audit_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- keep leads.updated_at honest
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions for RLS.
--
-- WHY THESE EXIST — this is the subtle part, read it before writing policies:
--
-- The natural policy is
--     tenant_id in (select tenant_id from memberships where user_id = auth.uid())
-- but `memberships` itself has RLS on. So evaluating that subquery triggers
-- the policy on memberships, which may query memberships again → infinite
-- recursion, and Postgres errors out.
--
-- `security definer` makes the function run as its owner, which bypasses RLS
-- inside the function body. `set search_path = ''` stops a caller from
-- shadowing `memberships` with their own table — without it, security definer
-- is a privilege-escalation hole.
--
-- `stable` lets Postgres call it once per query instead of once per row.
-- ---------------------------------------------------------------------------
create or replace function auth_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.memberships where user_id = auth.uid();
$$;

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. No policies yet ⇒ everything is denied to the anon
-- and authenticated roles. The service-role key still bypasses all of this,
-- which is exactly why it never goes near a client bundle.
-- ---------------------------------------------------------------------------
alter table tenants         enable row level security;
alter table profiles        enable row level security;
alter table memberships     enable row level security;
alter table plans           enable row level security;
alter table platform_admins enable row level security;
alter table voice_agents    enable row level security;
alter table calls           enable row level security;
alter table leads           enable row level security;
alter table usage_periods   enable row level security;
alter table invoices        enable row level security;
alter table change_requests enable row level security;
alter table audit_log       enable row level security;
