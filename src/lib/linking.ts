import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  SarvamClientError,
  type SarvamClient,
  type SarvamDeployment,
} from "@/lib/providers/sarvam-client";

/**
 * ============================================================================
 * Linking — the wiring step that makes a provider agent reachable by Voxline.
 * ============================================================================
 *
 * Spec: docs/superpowers/specs/2026-09-04-provider-control-plane-design.md,
 * "The wiring step". One function per provider, all doing the same five
 * things:
 *
 *   1. write or update the voice_agents row (the token is a DB default)
 *   2. tell the provider to POST finished calls to /api/webhooks/<p>/<token>
 *   3. read the provider back and check it really stored that URL
 *   4. record linked_at + webhook_verified_at
 *   5. audit — without the token
 *
 * Step 3 is the one that matters. On 2026-09-04 a live Sarvam deployment had
 * `webhook_config: null`, and nothing knew. An agent whose webhook cannot be
 * verified does not get `webhook_verified_at`, and setAgentStatus() refuses to
 * mark such an agent live.
 *
 * Dependencies are injected so this runs in tests against a fake provider and
 * the real local database.
 */

export type LinkResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

type Admin = SupabaseClient<Database>;

/** The one place the Sarvam webhook URL is built. Never log its return value. */
export function sarvamWebhookUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/webhooks/sarvam/${token}`;
}

/**
 * Strip the webhook token out of anything before it reaches a log.
 *
 * `/api/webhooks/sarvam/<64 hex>` — the token is the only thing authenticating
 * that provider's calls, so it must never be logged, and a provider error body
 * is exactly the place it can reappear without anyone intending it. Matches the
 * path shape rather than a bare hex run, so an unrelated 64-character id in a
 * payload is left readable.
 */
/**
 * Turn a failed webhook write into something a person can act on.
 *
 * The first real attempt said only "Sarvam rejected the webhook update", and an
 * hour went into hunting an inbound-webhook limitation that platform_docs
 * warned about. The actual reason was in the body all along:
 *
 *   "Only paused deployments can be edited. Current status: 'active'."
 *
 * A message that names the next action costs nothing and saves that hour. The
 * 422 is matched on its text rather than its status because 422 is Sarvam's
 * generic "Invalid Parameter" and will mean other things too; anything
 * unrecognised keeps the old wording rather than guessing.
 */
export function describeSetWebhookFailure(e: unknown): string {
  const saved = "The agent record was saved but is not linked.";
  if (e instanceof SarvamClientError && /only paused deployments/i.test(e.body)) {
    return (
      "Sarvam only lets a PAUSED deployment be edited, and this one is active. " +
      "Pause it in the Sarvam console, press Connect again, then resume it. " +
      saved
    );
  }
  return `Sarvam rejected the webhook update. ${saved}`;
}

export function redactWebhookToken(text: string): string {
  return text
    .replace(/(\/api\/webhooks\/[a-z]+\/)[A-Za-z0-9_-]{16,}/g, "$1<redacted>")
    .slice(0, 1200);
}

export async function linkSarvamDeployment(
  input: {
    tenantId: string;
    deploymentId: string;
    actorUserId: string;
    appUrl: string;
  },
  deps: { client: SarvamClient; admin: Admin }
): Promise<LinkResult> {
  const { client, admin } = deps;

  // 0. Fetch the deployment. This is also the existence check.
  let deployment: SarvamDeployment;
  try {
    deployment = await client.getDeployment(input.deploymentId);
  } catch (e) {
    if (e instanceof SarvamClientError && e.status === 404) {
      return { ok: false, error: `Deployment ${input.deploymentId} was not found in Sarvam.` };
    }
    console.error("[link] sarvam getDeployment failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Sarvam could not be reached. Try again in a moment." };
  }

  // 1a. Ownership. (provider, provider_agent_id) is unique across the table,
  // so this is a friendlier message for what the insert would reject anyway —
  // and it lets us bail before writing to Sarvam.
  const { data: owner } = await admin
    .from("voice_agents")
    .select("id, tenant_id")
    .eq("provider", "sarvam")
    .eq("provider_agent_id", deployment.app_id)
    .maybeSingle();

  if (owner && owner.tenant_id !== input.tenantId) {
    return {
      ok: false,
      error: `That deployment's agent (${deployment.app_id}) is already linked to another agency.`,
    };
  }

  // 1b. Write the row. Update THIS deployment's agent if the tenant already
  // has it, insert otherwise. The webhook token comes from the column default.
  //
  // Keyed on the deployment, not on (tenant, provider). The old version asked
  // "does this tenant have a Sarvam agent" because an agency was assumed to
  // have one line — and that assumption broke twice over:
  //
  //   * It could not tell "re-link the same deployment" (repair the row) from
  //     "link a second deployment" (add an agent). Both looked identical.
  //   * With two Sarvam agents on one tenant, `.maybeSingle()` over two rows
  //     makes PostgREST answer 406, so `data` came back null, the code took the
  //     insert branch, and the insert then tripped the unique index on
  //     (provider, provider_agent_id). An agency with two lines could not link
  //     either of them.
  //
  // Sarthak Singapore is one client with an agent per property, so this is now
  // the normal case rather than the exotic one. `owner` above already resolved
  // the row by (provider, provider_agent_id) — the actual unique index — so
  // reuse it rather than asking a second, weaker question.
  const fields = {
    name: deployment.name ?? `Sarvam ${deployment.deployment_id}`,
    provider: "sarvam" as const,
    provider_agent_id: deployment.app_id,
    provider_deployment_id: deployment.deployment_id,
    phone_number: deployment.phone_numbers[0] ?? null,
  };

  const existing = owner && owner.tenant_id === input.tenantId ? owner : null;

  const write = existing
    ? admin.from("voice_agents").update(fields).eq("id", existing.id)
    : admin.from("voice_agents").insert({ tenant_id: input.tenantId, status: "paused", ...fields });

  const { data: agent, error: writeError } = await write
    .select("id, webhook_token")
    .single();

  if (writeError || !agent?.webhook_token) {
    console.error("[link] voice_agents write failed", writeError?.message);
    return { ok: false, error: "The agent record could not be saved." };
  }

  // 2 + 3. Point Sarvam at us, then read back. `setWebhook` returns the
  // post-write state, but a separate GET is what proves the write persisted
  // rather than merely echoed.
  const url = sarvamWebhookUrl(input.appUrl, agent.webhook_token);
  let after: SarvamDeployment;
  try {
    await client.setWebhook(deployment.deployment_id, url);
    after = await client.getDeployment(deployment.deployment_id);
  } catch (e) {
    // Log Sarvam's REASON, not just its status code.
    //
    // The first real link attempt (2026-09-05, production, deployment
    // Voxline-Dem-e9d47cba-bfc5) returned 422: the endpoint exists and the key
    // was accepted, so Sarvam understood the request and refused the content.
    // Which is the whole question — platform_docs/sarvam.md records that an
    // inbound deployment has no webhook field in the console at all, and that
    // the working path for inbound is an agent-level `on_end` HTTPS tool. If
    // that is why this 422s, Sarvam's body says so and we could not see it,
    // because only `e.message` was logged and the body was dropped.
    //
    // The body is redacted first. A 422 commonly echoes the offending input
    // back, and the input here is the webhook URL, whose last path segment is
    // the token that authenticates every call this agent will ever send.
    console.error(
      "[link] sarvam setWebhook failed",
      e instanceof Error ? e.message : e,
      e instanceof SarvamClientError ? `body=${redactWebhookToken(e.body)}` : ""
    );
    return { ok: false, error: describeSetWebhookFailure(e) };
  }

  const sameNumbers = (a: string[], b: string[]) =>
    a.length === b.length &&
    [...a].sort().every((n, i) => n === [...b].sort()[i]);

  const verified =
    after.webhook_url === url &&
    after.app_version === deployment.app_version &&
    sameNumbers(after.phone_numbers, deployment.phone_numbers);

  if (!verified) {
    // Do not say what URL came back: it may be another tenant's token.
    console.error(
      `[link] sarvam did not confirm the webhook for ${deployment.deployment_id}` +
        ` (url match: ${after.webhook_url === url}, version ${deployment.app_version}→${after.app_version})`
    );
    return {
      ok: false,
      error:
        "Sarvam did not confirm the webhook after the update. The agent record was saved but is not linked.",
    };
  }

  // 4. Record it.
  const now = new Date().toISOString();
  const { error: stampError } = await admin
    .from("voice_agents")
    .update({ linked_at: now, webhook_verified_at: now, last_synced_at: now })
    .eq("id", agent.id);

  if (stampError) {
    console.error("[link] voice_agents timestamp update failed", stampError.message);
    return {
      ok: false,
      error: "The webhook was confirmed but the agent record could not be updated. Try again.",
    };
  }

  // 5. Audit. deployment_id, app_id and version are identifiers, not secrets.
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: input.tenantId,
    actor_user_id: input.actorUserId,
    action: "voice_agent.linked",
    payload: {
      provider: "sarvam",
      agent_id: agent.id,
      deployment_id: deployment.deployment_id,
      app_id: deployment.app_id,
      app_version: deployment.app_version,
      phone_numbers: deployment.phone_numbers,
    },
  });
  if (auditError) {
    console.error("[link] audit_log insert failed", auditError.message);
  }

  return { ok: true, agentId: agent.id };
}

/**
 * Confirm a Sarvam webhook that was pointed at Voxline outside the console —
 * pasted into Sarvam by hand, or set by a previous link that predates this
 * check. Without this, an agent's only path to `webhook_verified_at` was
 * `linkSarvamDeployment`, which re-links (and can steal) a deployment; an
 * admin who only needs to confirm what is already correct had nowhere to go.
 */
export async function verifySarvamWebhook(
  input: { agentId: string; actorUserId: string; appUrl: string },
  deps: { client: SarvamClient; admin: Admin }
): Promise<LinkResult> {
  const { client, admin } = deps;

  const { data: row } = await admin
    .from("voice_agents")
    .select("id, tenant_id, provider, provider_agent_id, provider_deployment_id, webhook_token")
    .eq("id", input.agentId)
    .maybeSingle();

  if (!row) return { ok: false, error: "That agent no longer exists." };
  if (row.provider !== "sarvam") {
    return { ok: false, error: "Only Sarvam agents can be verified this way." };
  }
  if (!row.webhook_token) {
    return { ok: false, error: "This agent has no webhook token to verify against." };
  }

  let deployment: SarvamDeployment;
  try {
    if (row.provider_deployment_id) {
      deployment = await client.getDeployment(row.provider_deployment_id);
    } else {
      const all = await client.listDeployments();
      const matches = all.filter((d) => d.app_id === row.provider_agent_id);
      if (matches.length === 0) {
        return {
          ok: false,
          error: `No Sarvam deployment uses app_id ${row.provider_agent_id}.`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          error:
            "More than one Sarvam deployment uses this app_id. Use the Connect panel below to pick the right one.",
        };
      }
      deployment = matches[0];
    }
  } catch (e) {
    if (e instanceof SarvamClientError && e.status === 404) {
      return { ok: false, error: "That Sarvam deployment was not found." };
    }
    console.error("[verify] sarvam lookup failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Sarvam could not be reached. Try again in a moment." };
  }

  const expected = sarvamWebhookUrl(input.appUrl, row.webhook_token);

  if (deployment.webhook_url !== expected) {
    return {
      ok: false,
      error:
        "Sarvam's webhook for this deployment does not point at Voxline. Re-connect the deployment, or paste the URL from the Webhooks tab into Sarvam and verify again.",
    };
  }

  const now = new Date().toISOString();
  const { data: current } = await admin
    .from("voice_agents")
    .select("linked_at")
    .eq("id", row.id)
    .maybeSingle();

  const { error: stampError } = await admin
    .from("voice_agents")
    .update({
      provider_deployment_id: deployment.deployment_id,
      ...(deployment.phone_numbers[0] ? { phone_number: deployment.phone_numbers[0] } : {}),
      ...(current?.linked_at ? {} : { linked_at: now }),
      webhook_verified_at: now,
      last_synced_at: now,
    })
    .eq("id", row.id);

  if (stampError) {
    console.error("[verify] voice_agents update failed", stampError.message);
    return {
      ok: false,
      error: "The webhook was confirmed but the agent record could not be updated. Try again.",
    };
  }

  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: row.tenant_id,
    actor_user_id: input.actorUserId,
    action: "voice_agent.webhook_verified",
    payload: {
      provider: "sarvam",
      agent_id: row.id,
      deployment_id: deployment.deployment_id,
      app_id: deployment.app_id,
      app_version: deployment.app_version,
    },
  });
  if (auditError) {
    console.error("[verify] audit_log insert failed", auditError.message);
  }

  return { ok: true, agentId: row.id };
}
