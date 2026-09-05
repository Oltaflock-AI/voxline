"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/app-url";
import { linkSarvamDeployment, verifySarvamWebhook } from "@/lib/linking";
import { PROVIDER_CAPABILITIES } from "@/lib/providers/capabilities";
import {
  sarvamClientFromEnv,
  type SarvamDeployment,
} from "@/lib/providers/sarvam-client";
import type { VoiceProvider } from "@/lib/ingest";

/**
 * The providers a form may name. Derived from the capability table so adding
 * a provider is one place, not three. Both agency forms used to check
 * `!== "sarvam" && !== "retell"`, which rejected Vapi even though the enum,
 * the migration and the <select> all had it.
 */
const VALID_PROVIDERS = Object.keys(PROVIDER_CAPABILITIES) as VoiceProvider[];
function isProvider(value: string): value is VoiceProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
}

/**
 * Admin mutations.
 *
 * EVERY ONE OF THESE RE-CHECKS requirePlatformAdmin(). A Server Action is a
 * POST endpoint — the fact that it is only rendered on a page behind a guard
 * does not stop anyone from calling it directly. The page check protects the
 * page; the action check protects the action.
 *
 * Both write to `audit_log`, because these change what a client sees (or
 * whether their phone line answers at all) and "who paused this agency?"
 * should have an answer.
 */

export async function setAgentStatus(formData: FormData) {
  const user = await requirePlatformAdmin();

  const agentId = String(formData.get("agentId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "live" && status !== "paused") return;

  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("voice_agents")
    .select("tenant_id, name, provider, webhook_verified_at")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return;

  // A Sarvam agent goes live only once Sarvam has confirmed it will POST to
  // our webhook. Without that, "live" means a phone line answering calls that
  // never reach the portal — which is exactly the failure this whole feature
  // exists to prevent. Sarvam only for now: the existing Vapi agent was wired
  // by hand before webhook_verified_at existed and must keep working.
  if (status === "live" && agent.provider === "sarvam" && !agent.webhook_verified_at) {
    revalidatePath("/admin");
    return;
  }

  await admin.from("voice_agents").update({ status }).eq("id", agentId);

  await admin.from("audit_log").insert({
    tenant_id: agent.tenant_id,
    actor_user_id: user.id,
    action: `voice_agent.${status}`,
    payload: { agent_id: agentId, agent_name: agent.name },
  });

  revalidatePath("/admin");
}

export async function resolveChangeRequest(formData: FormData) {
  const user = await requirePlatformAdmin();

  const id = String(formData.get("id") ?? "");
  const admin = createAdminClient();

  const { data: cr } = await admin
    .from("change_requests")
    .select("tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (!cr) return;

  await admin.from("change_requests").update({ status: "done" }).eq("id", id);

  await admin.from("audit_log").insert({
    tenant_id: cr.tenant_id,
    actor_user_id: user.id,
    action: "change_request.done",
    payload: { change_request_id: id },
  });

  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Agent requests — working the onboarding queue.
// ---------------------------------------------------------------------------

const STAGES = [
  "submitted",
  "in_review",
  "building",
  "test_ready",
  "number_pending",
  "completed",
  "cancelled",
] as const;
type Stage = (typeof STAGES)[number];

/**
 * Move a request along, optionally leaving a note the agency will read.
 *
 * `agent_requests` has no client-facing UPDATE policy, so this is the only way
 * a stage changes — which is the point. The note is shown verbatim in the
 * agency's progress tracker, so it is written for them, not as internal
 * shorthand.
 */
export async function setRequestStage(formData: FormData) {
  const user = await requirePlatformAdmin();

  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "") as Stage;
  const statusNote = String(formData.get("statusNote") ?? "").trim().slice(0, 500);
  if (!STAGES.includes(stage)) return;

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("agent_requests")
    .select("tenant_id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!req) return;

  await admin
    .from("agent_requests")
    .update({ stage, ...(statusNote ? { status_note: statusNote } : {}) })
    .eq("id", id);

  await admin.from("audit_log").insert({
    tenant_id: req.tenant_id,
    actor_user_id: user.id,
    action: "agent_request.stage",
    payload: { request_id: id, from: req.stage, to: stage },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/requests");
}

/**
 * A time-limited link to a document an agency uploaded.
 *
 * Minted on demand rather than rendered into the page: the admin console lists
 * every agency, so baking permanent links into it would put a working URL for
 * every client's pricing sheet into one HTML document.
 */
export async function getRequestFileUrl(
  storagePath: string
): Promise<{ url: string | null; error: string | null }> {
  await requirePlatformAdmin();

  const { data, error } = await createAdminClient()
    .storage.from("agent-documents")
    .createSignedUrl(storagePath, 300);

  if (error || !data) return { url: null, error: "That file could not be opened." };
  return { url: data.signedUrl, error: null };
}

// ---------------------------------------------------------------------------
// Agencies
// ---------------------------------------------------------------------------

export type AdminFormState = { error: string | null; ok: boolean; id?: string };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Create an agency, and optionally its first agent, in one step.
 *
 * This replaces onboarding by hand-written SQL — spec 6.7 asks for "list and
 * create tenants, attach agent IDs and phone numbers, set plan", and until now
 * only the listing existed. Typing INSERTs against a production database to
 * sign a client is how a wrong tenant_id ends up on a live phone line.
 */
export async function createAgency(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const user = await requirePlatformAdmin();

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase().slice(0, 40);
  const planId = String(formData.get("planId") ?? "").trim();
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim().toLowerCase();
  const agentName = String(formData.get("agentName") ?? "").trim().slice(0, 120);
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim().slice(0, 40);
  const provider = String(formData.get("provider") ?? "sarvam");
  const providerAgentId = String(formData.get("providerAgentId") ?? "").trim().slice(0, 200);

  if (!name) return { error: "Give the agency a name.", ok: false };
  if (!SLUG_RE.test(slug)) {
    return {
      error:
        "The URL name must be 3 to 40 characters long, using only lowercase letters, numbers and hyphens. It cannot start or end with a hyphen.",
      ok: false,
    };
  }
  if (!isProvider(provider)) {
    return { error: "Choose a valid provider.", ok: false };
  }

  const admin = createAdminClient();

  const { data: clash } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (clash) return { error: `The URL name "${slug}" is already taken.`, ok: false };

  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "AG";

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ name, slug, initials, ...(planId ? { plan_id: planId } : {}) })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    return { error: "That agency could not be created.", ok: false };
  }

  // Link the owner if we can find them. Deliberately not fatal: the agency is
  // created either way, and an unlinked agency is fixable from its own page
  // whereas a half-failed create that rolled back nothing is not.
  let ownerNote = "";
  if (ownerEmail) {
    const { data: users } = await admin.auth.admin.listUsers();
    const match = users?.users.find(
      (u) => u.email?.toLowerCase() === ownerEmail
    );
    if (match) {
      await admin
        .from("memberships")
        .insert({ user_id: match.id, tenant_id: tenant.id, role: "owner" });
    } else {
      ownerNote = ` No user with the email ${ownerEmail} exists yet, so nobody is linked to it.`;
    }
  }

  if (agentName) {
    await admin.from("voice_agents").insert({
      tenant_id: tenant.id,
      name: agentName,
      provider,
      provider_agent_id: providerAgentId || null,
      phone_number: phoneNumber || null,
      status: "paused",
    });
  }

  await admin.from("audit_log").insert({
    tenant_id: tenant.id,
    actor_user_id: user.id,
    action: "tenant.created",
    payload: { name, slug, owner_email: ownerEmail || null },
  });

  revalidatePath("/admin");
  return { error: ownerNote || null, ok: true, id: tenant.id };
}

/** Edit an agency's agent — the config that decides how a live line behaves. */
export async function updateAgent(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const user = await requirePlatformAdmin();

  const agentId = String(formData.get("agentId") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim().slice(0, 40);
  const providerAgentId = String(formData.get("providerAgentId") ?? "").trim().slice(0, 200);
  const provider = String(formData.get("provider") ?? "");
  const voiceDesc = String(formData.get("voiceDesc") ?? "").trim().slice(0, 200);
  const languages = String(formData.get("languages") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (!name) return { error: "The agent needs a name.", ok: false };
  if (!isProvider(provider)) {
    return { error: "Choose a valid provider.", ok: false };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("voice_agents")
    .select("tenant_id")
    .eq("id", agentId)
    .maybeSingle();
  if (!existing) return { error: "That agent no longer exists.", ok: false };

  const { error } = await admin
    .from("voice_agents")
    .update({
      name,
      provider,
      provider_agent_id: providerAgentId || null,
      phone_number: phoneNumber || null,
      voice_desc: voiceDesc || null,
      languages,
    })
    .eq("id", agentId);

  if (error) {
    // The commonest cause by far: (provider, provider_agent_id) is unique, so
    // two agencies cannot both claim the same provider agent. Say that rather
    // than showing a constraint name.
    return {
      error:
        "That could not be saved. Another agency may already use this provider agent ID, and each agent needs its own.",
      ok: false,
    };
  }

  await admin.from("audit_log").insert({
    tenant_id: existing.tenant_id,
    actor_user_id: user.id,
    action: "voice_agent.updated",
    payload: { agent_id: agentId, name },
  });

  revalidatePath("/admin");
  return { error: null, ok: true };
}

// ---------------------------------------------------------------------------
// Connecting a provider agent — slice 1 of the provider control plane.
// ---------------------------------------------------------------------------

export type DeploymentListState = {
  deployments: SarvamDeployment[];
  error: string | null;
};

/**
 * Every Sarvam deployment in our workspace, live from Sarvam.
 *
 * A server action rather than a route handler so the client component can
 * call it directly, and so the admin check is the same function as everywhere
 * else in this file. Errors are returned, not thrown: a Sarvam outage should
 * read as "Sarvam could not be reached", not as a Next error boundary.
 */
export async function listSarvamDeployments(): Promise<DeploymentListState> {
  await requirePlatformAdmin();

  const client = sarvamClientFromEnv();
  if (!client) {
    return {
      deployments: [],
      error:
        "Sarvam is not configured in this environment (SARVAM_VOICE_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID).",
    };
  }

  try {
    return { deployments: await client.listDeployments(), error: null };
  } catch (e) {
    console.error("[admin] listSarvamDeployments failed", e instanceof Error ? e.message : e);
    return { deployments: [], error: "Sarvam could not be reached. Try again in a moment." };
  }
}

/**
 * Adopt a provider agent for an agency and wire its webhook.
 *
 * Refuses when the app URL is not public: Sarvam would happily store
 * http://localhost:3000/... and never be able to reach it, and that failure
 * looks identical to "no calls today". Use a tunnel or a preview deployment.
 */
export async function linkAgent(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const user = await requirePlatformAdmin();

  const provider = String(formData.get("provider") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  const deploymentId = String(formData.get("deploymentId") ?? "").trim().slice(0, 200);

  if (!isProvider(provider) || !PROVIDER_CAPABILITIES[provider].connect) {
    return { error: "That provider cannot be connected from here yet.", ok: false };
  }
  if (!tenantId || !deploymentId) {
    return { error: "Choose a deployment to connect.", ok: false };
  }

  const appUrl = getAppUrl();
  if (!appUrl.startsWith("https://")) {
    return {
      error: `Webhooks need a public https URL and this environment is ${appUrl}. Link from a deployed environment, or set NEXT_PUBLIC_APP_URL to a tunnel.`,
      ok: false,
    };
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return { error: "That agency no longer exists.", ok: false };

  // Only Sarvam passes the capability check today; the switch is here so the
  // next provider is a new case rather than a new action.
  switch (provider as VoiceProvider) {
    case "sarvam": {
      const client = sarvamClientFromEnv();
      if (!client) {
        return { error: "Sarvam is not configured in this environment.", ok: false };
      }
      const result = await linkSarvamDeployment(
        { tenantId, deploymentId, actorUserId: user.id, appUrl },
        { client, admin }
      );
      if (!result.ok) return { error: result.error, ok: false };

      revalidatePath(`/admin/agencies/${tenantId}`);
      revalidatePath("/admin/webhooks");
      revalidatePath("/admin");
      return { error: null, ok: true, id: result.agentId };
    }
    default:
      return { error: "That provider cannot be connected from here yet.", ok: false };
  }
}

/**
 * Confirm a Sarvam webhook that already points at Voxline without re-linking
 * the deployment — the path for an agent whose URL was pasted into Sarvam's
 * console by hand, which `linkAgent` alone could never unblock.
 */
export async function verifyAgentWebhook(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const user = await requirePlatformAdmin();

  const agentId = String(formData.get("agentId") ?? "").trim();
  if (!agentId) return { error: "Choose an agent to verify.", ok: false };

  const appUrl = getAppUrl();
  if (!appUrl.startsWith("https://")) {
    return {
      error: `Webhooks need a public https URL and this environment is ${appUrl}. Verify from a deployed environment, or set NEXT_PUBLIC_APP_URL to a tunnel.`,
      ok: false,
    };
  }

  const client = sarvamClientFromEnv();
  if (!client) {
    return { error: "Sarvam is not configured in this environment.", ok: false };
  }

  const admin = createAdminClient();
  const { data: agentRow } = await admin
    .from("voice_agents")
    .select("tenant_id")
    .eq("id", agentId)
    .maybeSingle();
  if (!agentRow) return { error: "That agent no longer exists.", ok: false };

  const result = await verifySarvamWebhook(
    { agentId, actorUserId: user.id, appUrl },
    { client, admin }
  );
  if (!result.ok) return { error: result.error, ok: false };

  revalidatePath(`/admin/agencies/${agentRow.tenant_id}`);
  revalidatePath("/admin/webhooks");
  revalidatePath("/admin");
  return { error: null, ok: true, id: result.agentId };
}
