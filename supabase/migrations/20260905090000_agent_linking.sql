-- ============================================================================
-- Agent linking — the columns that record whether a provider agent is actually
-- wired to Voxline, rather than merely described in it.
-- ============================================================================
--
-- On 2026-09-04 the Sarvam deployment "Voxline Demo Test" was `active` on
-- Sarvam with `webhook_config: null`, and had no voice_agents row at all. Its
-- calls could never have reached /api/webhooks/sarvam, and nothing anywhere
-- said so. These columns exist so the admin console can show that state
-- instead of leaving it to be inferred from an absence of calls.
--
-- provider_deployment_id is separate from provider_agent_id because Sarvam has
-- two ids: the `app_id` (the authored agent, which every webhook payload
-- carries and which ingestion matches on) and the `deployment_id` (the thing
-- that owns phone numbers, hours and the webhook URL, and the thing our API
-- calls address). Overloading one column with both is how the wrong id gets
-- PATCHed. Retell and Vapi have no such split; the column stays null for them.
--
-- webhook_verified_at is set only after the provider has been asked to store
-- our URL AND has been read back reporting it. It is the evidence that the
-- wiring step completed, and setAgentStatus() refuses to mark a Sarvam agent
-- `live` without it.
-- ============================================================================

alter table voice_agents
  add column if not exists provider_deployment_id text,
  add column if not exists linked_at              timestamptz,
  add column if not exists webhook_verified_at    timestamptz,
  add column if not exists last_synced_at         timestamptz;

-- One deployment cannot back two agents, same as one app_id cannot. Partial so
-- the many rows with a null deployment id (Retell, Vapi, hand-entered) do not
-- collide with each other.
create unique index if not exists voice_agents_provider_deployment_uniq
  on voice_agents (provider, provider_deployment_id)
  where provider_deployment_id is not null;
