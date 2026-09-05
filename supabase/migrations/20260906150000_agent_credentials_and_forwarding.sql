-- ============================================================================
-- Per-agent provider credentials, and an optional webhook forward.
-- ============================================================================
--
-- WHY A CREDENTIAL REFERENCE
--
-- Every provider credential in Voxline is a single environment variable:
-- SARVAM_VOICE_API_KEY, VAPI_API_KEY, RETELL_API_KEY. That holds while one
-- Oltaflock account owns every agent on a provider. ElevenLabs breaks it: Rise
-- & Shine's agent lives in one workspace and Sarthak Singapore's three live in
-- another, on a different login. ElevenLabs keys are workspace-scoped, so a key
-- for one cannot see the other — it answers "Document with id … not found",
-- which reads as a missing agent rather than a wrong credential.
--
-- So the agent has to say which credential to use.
--
-- IT STORES A NICKNAME, NOT AN ENVIRONMENT VARIABLE NAME.
--
-- The obvious version puts "ELEVENLABS_API_KEY_RISESHINE" in the column and
-- does process.env[row.credential_ref]. That is an exfiltration primitive:
-- anyone who can write this column sets it to SUPABASE_SERVICE_ROLE_KEY and
-- Voxline sends its own service-role key to ElevenLabs in an xi-api-key
-- header. Only a platform admin can write it today, but the house style is to
-- make the unsafe thing impossible rather than merely unlikely.
--
-- The column holds `riseshine`; src/lib/providers/elevenlabs-credentials.ts
-- builds the variable name from it. The CHECK below keeps that invariant true
-- even for a hand-written UPDATE, which is the case the application cannot
-- defend against.
--
-- NULL means the provider's default credential, which is what every existing
-- agent wants — hence nullable with no backfill.
--
-- Deliberately named for credentials in general, not for ElevenLabs: Sarvam
-- hits exactly this the day a client has their own org.
--
-- WHY A FORWARD URL
--
-- An ElevenLabs agent has exactly one post-call webhook. Rise & Shine's
-- currently posts to their own dashboard, which is how their `voice_calls`
-- table is written. Pointing it at Voxline therefore stops their product
-- recording calls — repointing is a migration, not an addition.
--
-- When set, Voxline forwards the delivery on, byte for byte and with the
-- original signature header, so their HMAC still verifies against the same
-- secret and nothing on their side changes. The two status columns exist
-- because a forward that silently stopped working would otherwise be
-- discovered by the client phoning Khush.
--
-- Off by default: an empty column forwards nothing.
-- ============================================================================

alter table voice_agents
  add column credential_ref text
    check (credential_ref is null or credential_ref ~ '^[a-z0-9_]{1,32}$'),
  add column webhook_forward_url text
    check (webhook_forward_url is null or webhook_forward_url like 'https://%'),
  add column webhook_forward_last_status integer,
  add column webhook_forward_last_at timestamptz;

comment on column voice_agents.credential_ref is
  'Which provider workspace this agent belongs to, as a nickname (e.g. riseshine). Resolved to an environment variable name in code — never store a variable name here, and never a secret.';

comment on column voice_agents.webhook_forward_url is
  'Optional. Voxline re-POSTs each authenticated delivery here, raw body and signature header unchanged, so a system that used to receive this webhook keeps working. https only.';
