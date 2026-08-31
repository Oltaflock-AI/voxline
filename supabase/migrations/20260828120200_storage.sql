-- ============================================================================
-- Recording storage. Spec §8: "Recordings live in a private bucket, served
-- through short-lived signed URLs." Listed under "never cut".
-- ============================================================================

-- public = false. A public bucket would make every recording readable by
-- anyone who can guess a URL, and these are recordings of real people's phone
-- calls. Signed URLs are the only way in.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Path convention: <tenant_id>/<call_id>.<ext>
--
-- Putting tenant_id in the first path segment is what makes the policy below
-- possible: storage.foldername(name) splits the path, and [1] is that segment.
-- The webhook must write recordings to this shape or they become unreadable.
--
-- Defence in depth. The app also checks ownership before it signs a URL, but
-- if that check is ever wrong, this policy still refuses the object.
-- ---------------------------------------------------------------------------
create policy recordings_select_own_tenant
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid())
    )
  );

-- No insert/update/delete policy: uploads come from the ingestion webhook on
-- the service role, which bypasses RLS. Clients never write recordings.
