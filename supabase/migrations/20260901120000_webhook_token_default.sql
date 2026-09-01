-- ============================================================================
-- Give every voice agent a webhook token, not just the ones that existed in
-- August.
-- ============================================================================
--
-- 20260829130000_generalise_provider.sql added `webhook_token` and filled it
-- with a one-off UPDATE. That covered the agents alive at the time and nothing
-- since: the column had no default, so every agent created afterwards got
-- NULL.
--
-- For a Sarvam agent that is not cosmetic. The token in the URL path is the
-- only thing authenticating Sarvam's post-call delivery — there is no
-- signature — so an agent without one has no reachable webhook URL, and the
-- agency's calls would never arrive. Found on 2026-09-01 by creating an agency
-- through the new admin form and noticing its agent came out with a null
-- token, which the console then reported as "no webhook token on this agent".
--
-- A DEFAULT rather than a fix in the application: agents are created from the
-- admin console today, and were created by hand-written SQL until yesterday.
-- Anything that inserts a row should get a working token without having to
-- know that it must.
-- ============================================================================

alter table voice_agents
  alter column webhook_token
  set default (
    -- Two UUIDs, hyphens stripped: 64 hex characters, 256 bits of entropy.
    -- Matches what the original backfill produced, so old and new tokens are
    -- indistinguishable in shape.
    replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '')
  );

-- Catch anything created in the gap between the two migrations.
update voice_agents
   set webhook_token = replace(gen_random_uuid()::text, '-', '')
                    || replace(gen_random_uuid()::text, '-', '')
 where webhook_token is null;
