-- ============================================================================
-- Agent requests — the structured intake that replaces free-text onboarding.
-- ============================================================================
--
-- Spec §6.6 keeps agent configuration concierge-managed: "clients do not edit
-- agent config directly in v1, a bad config breaks a live phone line". That
-- rule stands. What was missing was a decent way to ASK, so requirements were
-- gathered over WhatsApp and nothing was recorded in a structured form. The
-- cost of that is already visible: the Blue Harbor test agent greets callers as
-- "Rise and Shine Travel" because a prompt was copied between clients and there
-- was no record of what Blue Harbor actually asked for.
--
-- Two kinds of request, one table, because they are the same object at
-- different points in its life:
--   new_agent        the full onboarding intake, before an agent exists
--   document_update  new price lists or guides for an agent already live
--
-- Decisions behind this (Adnan, 2026-08-31), so the shape is not mistaken for
-- an accident:
--   - Oltaflock rents the phone numbers. The agency does no paperwork, which is
--     why the form asks about their EXISTING line rather than asking them to
--     supply a number.
--   - Agencies are created in the admin console, never from this form.
--   - Every Sarvam agent is built by hand, so nothing here calls a provider API.
--   - Documents attach to a REQUEST, never to a free-standing per-agency
--     library. We push them into Sarvam's knowledge base manually, so an agency
--     silently swapping a price list would leave the portal disagreeing with
--     what the agent actually says on the phone.
-- ============================================================================

create type agent_request_kind as enum ('new_agent', 'document_update');

-- One stage list covers both kinds; a document_update simply never enters the
-- middle stages. Keeping it as one enum avoids a second near-identical type,
-- and the UI labels the terminal stage per kind ("Live" vs "Applied").
create type agent_request_stage as enum (
  'submitted',
  'in_review',
  'building',
  'test_ready',
  'number_pending',
  'completed',
  'cancelled'
);

create table agent_requests (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       agent_request_kind not null,
  stage      agent_request_stage not null default 'submitted',

  -- The answers, as given. jsonb rather than thirty columns because the form
  -- will change shape as we learn what agencies actually need, and a request
  -- must keep the questions AS ASKED at the time — migrating old rows to a new
  -- question set would rewrite history we may need to defend.
  payload    jsonb not null default '{}'::jsonb,

  -- What the agency said alongside a document update ("new winter pricing,
  -- Bali package withdrawn"). Required for document_update, unused otherwise.
  note       text,

  -- Filled by Oltaflock as the request is worked. Visible to the agency, so it
  -- is written for them to read, not as internal shorthand.
  status_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_requests_tenant_idx on agent_requests (tenant_id, created_at desc);
create index agent_requests_open_idx on agent_requests (stage)
  where stage not in ('completed', 'cancelled');

-- Reuses set_updated_at() from the initial schema, the same trigger leads uses.
create trigger agent_requests_set_updated_at
  before update on agent_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Files attached to a request.
--
-- A row per file rather than listing the storage bucket: we need the original
-- filename (storage paths are sanitised), the size, and a stable link to the
-- request. Listing a bucket by prefix would also make the admin console depend
-- on storage staying reachable to render a queue.
-- ---------------------------------------------------------------------------
create table agent_request_files (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references agent_requests(id) on delete cascade,
  -- Denormalised from the request so the RLS policy below is a single-table
  -- check rather than a join on every row read.
  tenant_id   uuid not null references tenants(id) on delete cascade,
  storage_path text not null unique,
  filename    text not null,
  size_bytes  bigint not null check (size_bytes > 0),
  mime_type   text not null,
  created_at  timestamptz not null default now()
);

create index agent_request_files_request_idx on agent_request_files (request_id);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Agencies may read and create their own requests. They may NOT update one:
-- `stage` and `status_note` are Oltaflock's to write, and an agency that could
-- set its own request to "completed" would break the queue. Admin writes go
-- through the service role, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
alter table agent_requests enable row level security;
alter table agent_request_files enable row level security;

create policy agent_requests_select_tenant
  on agent_requests for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

create policy agent_requests_insert_own
  on agent_requests for insert
  to authenticated
  with check (
    tenant_id in (select auth_tenant_ids())
    and user_id = (select auth.uid())
  );

create policy agent_request_files_select_tenant
  on agent_request_files for select
  to authenticated
  using (tenant_id in (select auth_tenant_ids()));

create policy agent_request_files_insert_tenant
  on agent_request_files for insert
  to authenticated
  with check (tenant_id in (select auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Document storage.
--
-- Unlike `recordings`, which only ever receives writes from the ingestion
-- webhook on the service role, this bucket takes uploads from CLIENTS. That is
-- untrusted input, so it needs three things recordings does not:
--
--   1. an insert policy, scoped to the uploader's own tenant folder
--   2. size and MIME limits set ON THE BUCKET, enforced by Supabase server-side
--      — the browser check is a courtesy to the user and trivially bypassed
--   3. uploads performed with the user's own client so the policy applies
--
-- Path convention matches recordings: <tenant_id>/<request_id>/<file>. First
-- segment is the tenant so the same storage.foldername() check works.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-documents',
  'agent-documents',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do nothing;

create policy agent_documents_select_own_tenant
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agent-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid())
    )
  );

create policy agent_documents_insert_own_tenant
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'agent-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid())
    )
  );

-- Delete, so an agency can remove a file they attached by mistake before we
-- act on it. Scoped identically — they can only ever reach their own folder.
create policy agent_documents_delete_own_tenant
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'agent-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid())
    )
  );
