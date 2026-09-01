"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AgentRequestState = { error: string | null; ok: boolean };

/** What the browser reports after putting a file in the bucket. */
export type UploadedFile = {
  storagePath: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
};

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

function text(form: FormData, key: string, limit = 2000): string {
  return String(form.get(key) ?? "").trim().slice(0, limit);
}

/**
 * Turn the browser's file report into rows we trust.
 *
 * The browser sends paths it claims to have written. It cannot actually write
 * outside its own tenant folder — the storage policy in
 * 20260831180000_agent_requests.sql enforces that — but it could still *claim*
 * a path belonging to someone else and get that string stored in our table.
 * Checking the prefix here keeps the database honest as well as the bucket.
 */
function verifiedFiles(
  raw: string,
  tenantId: string,
  requestId: string
): UploadedFile[] | null {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_FILES) return null;

  const prefix = `${tenantId}/${requestId}/`;
  const files: UploadedFile[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const f = item as Record<string, unknown>;
    if (
      typeof f.storagePath !== "string" ||
      typeof f.filename !== "string" ||
      typeof f.mimeType !== "string" ||
      typeof f.sizeBytes !== "number"
    ) {
      return null;
    }
    if (!f.storagePath.startsWith(prefix)) return null;
    if (f.sizeBytes <= 0 || f.sizeBytes > MAX_BYTES) return null;

    files.push({
      storagePath: f.storagePath,
      filename: f.filename.slice(0, 300),
      sizeBytes: f.sizeBytes,
      mimeType: f.mimeType.slice(0, 200),
    });
  }
  return files;
}

/**
 * Resolve a tenant from its slug using the caller's own client, so RLS decides
 * membership. Never trust a tenant id posted from a form.
 */
async function resolveTenant(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, tenantId: null, supabase };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  return { user, tenantId: tenant?.id ?? null, supabase };
}

/**
 * The onboarding intake — spec §6.6 keeps agent configuration concierge-managed
 * because a bad config breaks a live phone line. This does not change that
 * rule; it replaces the free-text ask with a structured one so requirements
 * stop being gathered over WhatsApp in three rounds.
 *
 * Stored as jsonb rather than columns on purpose: the questions will change as
 * we learn what agencies actually need, and a submitted request has to keep the
 * questions as they were asked.
 */
export async function submitAgentRequest(
  _prev: AgentRequestState,
  formData: FormData
): Promise<AgentRequestState> {
  const tenantSlug = text(formData, "tenantSlug", 200);
  const requestId = text(formData, "requestId", 60);

  if (!/^[0-9a-f-]{36}$/.test(requestId)) {
    return { error: "We couldn't read that form. Reload the page and try again.", ok: false };
  }

  const payload = {
    agency_summary: text(formData, "agency_summary"),
    top_requests: text(formData, "top_requests"),
    purpose: text(formData, "purpose", 40),
    direction: text(formData, "direction", 40),
    greeting: text(formData, "greeting"),
    languages: text(formData, "languages", 300),
    voice: text(formData, "voice", 40),
    must_capture: text(formData, "must_capture"),
    outreach_goal: text(formData, "outreach_goal"),
    hours: text(formData, "hours", 300),
    after_hours: text(formData, "after_hours"),
    escalation_number: text(formData, "escalation_number", 40),
    existing_number: text(formData, "existing_number", 40),
    existing_number_action: text(formData, "existing_number_action", 40),
  };

  // Only the starred fields. Everything else has a sensible default or can be
  // inferred, and blocking on them would just push people to type filler.
  const required: [keyof typeof payload, string][] = [
    ["agency_summary", "Tell us what your agency does."],
    ["purpose", "Choose what the agent should do."],
    ["greeting", "Tell us how the agent should answer the phone."],
    ["languages", "Choose at least one language."],
    ["must_capture", "Tell us what the agent must ask every caller."],
    ["hours", "Tell us your opening hours."],
    ["after_hours", "Tell us what should happen outside opening hours."],
    ["escalation_number", "Give us a number for transferring urgent calls."],
  ];
  for (const [key, message] of required) {
    if (!payload[key]) return { error: message, ok: false };
  }

  const { user, tenantId, supabase } = await resolveTenant(tenantSlug);
  if (!user) return { error: "Your session expired. Sign in again.", ok: false };
  if (!tenantId) return { error: "We couldn't find that agency.", ok: false };

  const files = verifiedFiles(
    String(formData.get("files") ?? ""),
    tenantId,
    requestId
  );
  if (files === null) {
    return { error: "We couldn't read those attachments. Try again.", ok: false };
  }

  const { error } = await supabase.from("agent_requests").insert({
    id: requestId,
    tenant_id: tenantId,
    user_id: user.id,
    kind: "new_agent",
    payload,
  });
  if (error) {
    return { error: "We couldn't send that request. Try again.", ok: false };
  }

  if (files.length > 0) {
    const { error: fileError } = await supabase.from("agent_request_files").insert(
      files.map((f) => ({
        request_id: requestId,
        tenant_id: tenantId,
        storage_path: f.storagePath,
        filename: f.filename,
        size_bytes: f.sizeBytes,
        mime_type: f.mimeType,
      }))
    );
    // The request itself is the thing that must not be lost. If only the file
    // rows fail, say so rather than silently accepting a request whose
    // attachments we cannot see.
    if (fileError) {
      return {
        error:
          "We received your request, but the files did not attach. Send them to your Voxline contact.",
        ok: false,
      };
    }
  }

  revalidatePath(`/app/${tenantSlug}/agent`);
  return { error: null, ok: true };
}

/**
 * A document update for an agent that is already live.
 *
 * Deliberately a request rather than a direct edit, and not because it is
 * easier: we push these into Sarvam's knowledge base by hand, so an agency
 * silently swapping a price list would leave the portal disagreeing with what
 * the agent actually says on the phone. Routing it through us keeps the two in
 * step. The `note` is what tells us what changed and why.
 */
export async function submitDocumentUpdate(
  _prev: AgentRequestState,
  formData: FormData
): Promise<AgentRequestState> {
  const tenantSlug = text(formData, "tenantSlug", 200);
  const requestId = text(formData, "requestId", 60);
  const note = text(formData, "note", 4000);

  if (!/^[0-9a-f-]{36}$/.test(requestId)) {
    return { error: "We couldn't read that form. Reload the page and try again.", ok: false };
  }
  if (note.length < 10) {
    return { error: "Tell us briefly what changed in these documents.", ok: false };
  }

  const { user, tenantId, supabase } = await resolveTenant(tenantSlug);
  if (!user) return { error: "Your session expired. Sign in again.", ok: false };
  if (!tenantId) return { error: "We couldn't find that agency.", ok: false };

  const files = verifiedFiles(
    String(formData.get("files") ?? ""),
    tenantId,
    requestId
  );
  if (files === null) {
    return { error: "We couldn't read those attachments. Try again.", ok: false };
  }
  if (files.length === 0) {
    return { error: "Attach at least one document.", ok: false };
  }

  const { error } = await supabase.from("agent_requests").insert({
    id: requestId,
    tenant_id: tenantId,
    user_id: user.id,
    kind: "document_update",
    note,
  });
  if (error) {
    return { error: "We couldn't send that update. Try again.", ok: false };
  }

  const { error: fileError } = await supabase.from("agent_request_files").insert(
    files.map((f) => ({
      request_id: requestId,
      tenant_id: tenantId,
      storage_path: f.storagePath,
      filename: f.filename,
      size_bytes: f.sizeBytes,
      mime_type: f.mimeType,
    }))
  );
  if (fileError) {
    return {
      error:
        "We received your note, but the files did not attach. Send them to your Voxline contact.",
      ok: false,
    };
  }

  revalidatePath(`/app/${tenantSlug}/agent`);
  return { error: null, ok: true };
}
