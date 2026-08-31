"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("tenant_id, name")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return;

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
