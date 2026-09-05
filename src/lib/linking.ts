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

  // 1b. Write the row. Update the tenant's existing Sarvam agent if there is
  // one — an agency has one line, and re-linking should repair it, not add a
  // second. Insert otherwise. The webhook token comes from the column default.
  const fields = {
    name: deployment.name ?? `Sarvam ${deployment.deployment_id}`,
    provider: "sarvam" as const,
    provider_agent_id: deployment.app_id,
    provider_deployment_id: deployment.deployment_id,
    phone_number: deployment.phone_numbers[0] ?? null,
  };

  const { data: existing } = await admin
    .from("voice_agents")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("provider", "sarvam")
    .maybeSingle();

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
    console.error("[link] sarvam setWebhook failed", e instanceof Error ? e.message : e);
    return {
      ok: false,
      error: "Sarvam rejected the webhook update. The agent record was saved but is not linked.",
    };
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
