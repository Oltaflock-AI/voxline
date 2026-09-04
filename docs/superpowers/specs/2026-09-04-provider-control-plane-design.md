# Provider control plane — design

Date: 2026-09-04
Status: approved, not yet implemented

## Problem

Voxline's provider adapters (`src/lib/providers/{retell,sarvam,vapi}.ts`) are
inbound-only: they parse post-call webhooks and normalise them for
`src/lib/ingest.ts`. Nothing in the codebase calls a provider API outbound.

Consequently every agent is created by hand in the provider's own console, and
`supabase/migrations/20260831180000_agent_requests.sql` records the cost of
that: a prompt copied between clients left the Blue Harbor test agent greeting
callers as "Rise and Shine Travel". `agent_requests` structured the *intake*
but deliberately stopped short of touching a provider API.

The state of the system on 2026-09-04 shows the second cost — silent
non-integration:

- `voice_agents` holds one row: `Larkin Travel Trip Line`, provider `vapi`.
- `calls` holds 22 rows, all `vapi`.
- A Sarvam deployment `Voxline Demo Test` (`deployment_id`
  `Voxline-Dem-e9d47cba-bfc5`) is `active` on Sarvam with
  `webhook_config: null`, and has no `voice_agents` row in Voxline.

Nobody was alerted, because nothing checks. An agent can be live at a provider
and invisible to Voxline, and the only symptom is an absence of calls.

## Goal

Create, link and manage voice agents from the admin console across all three
providers, with the post-call webhook wired automatically rather than
remembered.

Scope is the admin console only. Tenant-facing self-service is explicitly out
of scope — see "Why admin-only" below.

## Verified provider capabilities

Established on 2026-09-04 by probing the live APIs with working credentials,
not by reading marketing pages.

Sarvam's OpenAPI spec (`https://docs.sarvam.ai/conversations/openapi/voice-agents.yaml`,
base `https://apps.sarvam.ai/api/app-authoring`) publishes deployments,
campaigns, cohorts, instant outbound, analytics and BYOK. Probing for
`apps`, `agents`, `apps/{id}`, `knowledge-bases`, `documents`,
`phone-numbers` and `voices` returned 404 on every one.

| Capability | Retell | Vapi | Sarvam |
|---|---|---|---|
| author / update agent | API | API | console only |
| publish | API | API | `PATCH /deployments/{id}/status` |
| knowledge base | API | API | console only |
| purchase number | — | — | no API; Twilio supplies |
| attach number | API | API | deployment `connection_configs` |
| set post-call webhook | API | API | deployment `webhook_config.url` |
| outbound call | API | API | `POST /outbounds` |
| campaigns | build | build | native |

Sarvam therefore splits in two. Authoring (prompt, voice, knowledge base) is
console work. Deployment — which `app_version` is live, on which numbers,
during which hours, pointing at which webhook — is fully API-controlled. The
second half is the half that was broken, so automating it is worth doing even
though the first half cannot be.

Sarvam auth is `x-api-key`. `Authorization: Bearer` is rejected, and the `sk_`
speech key used for recordings is rejected with "Invalid API key format" — the
Voice Agents key is separate and workspace-scoped. It is stored as
`SARVAM_VOICE_API_KEY` (local: `.env.development.local`; Vercel: preview and
production).

`RETELL_API_KEY` does not exist in any environment. Retell work is blocked on
Khush supplying one.

## Why admin-only

`agent_requests` states the rule: "clients do not edit agent config directly in
v1, a bad config breaks a live phone line." That still holds. Additionally
Oltaflock rents the phone numbers, so provisioning spends Oltaflock's money —
that never becomes self-serve.

The design makes tenant-facing access a later permission change rather than a
rewrite, by separating two verbs from the start: editing writes a draft, and
publishing is a distinct, authorised action. Who may call which verb is a role
check.

## Design

### Linking is the primitive

Every provider can list what it already has; only some can create. Making
"adopt an existing agent and wire it up" the core verb means all three
providers work on day one, and creation is an extra affordance on the two that
support it.

Three screens under `/admin/agencies/[tenantId]/agent`:

**Connect.** Choose a provider; Voxline lists real agents (Retell, Vapi) or
deployments (Sarvam) from that provider's API; choosing one runs the wiring
step below.

**Build** (Retell and Vapi only). An authoring form writing a draft
`agent_versions` row. Publishing creates the agent at the provider, then runs
the same wiring step.

**Manage.** Shows number, hours, webhook status, and drift between what Voxline
believes and what the provider reports (`app_version` for Sarvam, a config
hash elsewhere). Offers re-publish and rollback.

### The wiring step

One function, shared by all three paths:

1. mint a 256-bit `webhook_token`
2. write or update the `voice_agents` row
3. set the provider's post-call webhook to `/api/webhooks/{provider}/{token}`
4. read it back from the provider and confirm it took
5. record `linked_at` and `webhook_verified_at`

An agent whose webhook cannot be set or verified does not reach `live`. This is
what makes `webhook_config: null` unrepeatable: publishing is the thing that
sets the webhook, so the two cannot drift apart.

### Provider clients

Each adapter gains an outbound half alongside its existing parser, behind one
interface: `listAgents`, `createAgent`, `updateAgent`, `publishAgent`,
`setWebhook`, `getWebhook`, `attachNumber`, `listVoices`.

Each adapter also declares its capabilities. The builder renders against that
declaration: where a provider cannot do something the UI says so and offers the
manual path. It never shows a control that will fail.

A canonical Voxline config shape maps into each provider's payload. Where a
provider cannot express part of the canonical config, the adapter reports it and
the UI surfaces it — never a silent drop.

### Data model

`agent_versions` — `tenant_id`, `agent_id`, `config jsonb`, `status`
(draft/published/archived), `provider_version_ref` (Sarvam's `app_version`),
`published_at`, `published_by`. Rollback and drift detection both derive from
this.

`phone_numbers` — `tenant_id`, `e164`, `supplier` (twilio/sarvam/manual),
`country`, `supplier_ref`, `agent_id` (nullable), `status`, `monthly_cost`.
One inventory across suppliers, so Indian and US numbers do not become two code
paths.

`voice_agents` — add `linked_at`, `webhook_verified_at`, `last_synced_at`.

RLS: both new tables are tenant-scoped like every other table. Writes happen
through the service role from admin server actions.

### Telephony

Twilio is the number supplier for both markets. Not on price — Telnyx is
cheaper on DIDs and per-minute SIP — but because Retell and Vapi both import a
Twilio number through an API call, whereas Telnyx means configuring a SIP trunk
by hand. At current volume the price delta is negligible and the integration
cost is not. `phone_numbers.supplier` keeps Telnyx a later swap behind the same
interface.

Sarvam takes a Twilio number as bring-your-own telephony via
`connection_configs`.

## Build order

Each slice ships working on its own.

1. **Sarvam Connect.** Credentials verified working. Fixes the live gap: the
   demo deployment has no webhook and no `voice_agents` row. Proves the wiring
   step against a real provider.
2. **Vapi Connect and Build.** `VAPI_API_KEY` is already in Vercel. First true
   one-click creation.
3. **Retell.** Blocked on `RETELL_API_KEY`.
4. **Twilio numbers.** `phone_numbers` inventory, purchase, attach at publish.

Slice 1 is deliberately first because it is small and carries the riskiest
assumption — that provider-side webhook writes work cleanly. If they do, the
remaining slices are repetition.

## Out of scope

- Tenant-facing agent editing (later permission change on the same machinery)
- Knowledge-base push for Sarvam (no API exists)
- Outbound campaigns and reactivation (own phase; Sarvam's native campaigns API
  is the likely foundation)
- Telnyx
- Add-on entitlements and metering

## Risks

**Sarvam authoring stays manual.** Nothing in this design removes the console
step for prompts and knowledge bases. Drift detection via `app_version`
mitigates but does not eliminate it.

**Sarvam webhooks are unsigned.** Unchanged from today: the URL token both
identifies and authenticates. It cannot detect a tampered body, and it leaks if
the URL is logged or screenshotted. Automating the webhook write increases how
many places that URL passes through, so it must never be logged.

**Provider APIs may reject the canonical config.** The capability declaration
is a static claim about a moving target. Publishing must surface the provider's
own error rather than a generic failure.

**Retell is unverified.** Its capabilities in the table above come from
documentation, not from probing, because no key exists. Confirm before slice 3.
