-- ============================================================================
-- Generalise the voice provider: Retell OR Sarvam (or the next one).
--
-- WHY. Spec §3 and §11 name Retell as the runtime, and the schema hard-coded
-- that in two column names: calls.retell_call_id and
-- voice_agents.retell_agent_id. The build has moved to Sarvam for the pilot
-- agent, and the bake-off means both need to work at once.
--
-- NOTE FOR KHUSH: this is a divergence from the spec, which still says Retell
-- throughout. The schema now supports either; which one a tenant actually uses
-- is per-agent config, not a platform-wide decision. Spec §3's own framing
-- allows this — "Keep the shape even if a component is swapped."
--
-- Renaming rather than adding parallel columns: two id columns where one is
-- always null is how you get a handler that reads the wrong one.
-- ============================================================================

create type voice_provider as enum ('retell', 'sarvam');

-- ---------------------------------------------------------------------------
-- voice_agents: which provider runs this agent, and its id over there.
-- ---------------------------------------------------------------------------
alter table voice_agents
  rename column retell_agent_id to provider_agent_id;

alter table voice_agents
  add column provider voice_provider not null default 'retell';

-- The old UNIQUE on retell_agent_id came along with the rename. Two providers
-- could legitimately issue the same opaque id, so uniqueness belongs on the
-- pair, not the bare id.
alter table voice_agents
  drop constraint if exists voice_agents_retell_agent_id_key;

create unique index if not exists voice_agents_provider_agent_uniq
  on voice_agents (provider, provider_agent_id);

-- ---------------------------------------------------------------------------
-- calls: same treatment. provider_call_id is the idempotency key the webhook
-- upserts on, so getting its uniqueness right is load-bearing (see the
-- ingestion notes in src/lib/ingest.ts).
-- ---------------------------------------------------------------------------
alter table calls
  rename column retell_call_id to provider_call_id;

alter table calls
  add column provider voice_provider not null default 'retell';

alter table calls
  drop constraint if exists calls_retell_call_id_key;

create unique index if not exists calls_provider_call_uniq
  on calls (provider, provider_call_id);

-- ---------------------------------------------------------------------------
-- Per-agent inbound webhook secret.
--
-- Retell signs its webhooks with HMAC-SHA256 and we verify that. Sarvam does
-- not sign at all — there is no signature header documented anywhere in
-- docs.sarvam.ai, and the payload carries nothing secret to key off.
--
-- So for unsigned providers the URL itself is the credential: Sarvam is
-- configured to POST to /api/webhooks/sarvam/<token>, and we compare the token
-- in constant time. That is weaker than a signature — it cannot detect a
-- tampered body, and it leaks if the URL is ever logged or shared — so it is
-- per-agent and rotatable rather than one global secret.
--
-- Spec §8 requires webhook verification and lists it under "never cut". This
-- is the strongest verification an unsigned provider allows; if Sarvam ships
-- signing later, move to it.
-- ---------------------------------------------------------------------------
alter table voice_agents
  add column if not exists webhook_token text unique;

-- gen_random_uuid() twice = 256 bits of entropy, which is not guessable.
update voice_agents
   set webhook_token = replace(gen_random_uuid()::text, '-', '')
                    || replace(gen_random_uuid()::text, '-', '')
 where webhook_token is null;

-- ---------------------------------------------------------------------------
-- Point the seeded agents at Sarvam, since that is what the pilot uses.
-- ---------------------------------------------------------------------------
update voice_agents set provider = 'sarvam'
 where provider_agent_id like 'agent_seed_%';
