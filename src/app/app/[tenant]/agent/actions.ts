"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ChangeRequestState = { error: string | null; ok: boolean };

/**
 * "Request a change" — spec §6.6: writes a `change_requests` row and notifies
 * platform admins.
 *
 * The email is Phase 2 (cut for this sprint, see the build plan). The row is
 * the part that matters: it means a request is never lost even if notification
 * fails, and the admin console works the queue from the table.
 */
export async function submitChangeRequest(
  _prev: ChangeRequestState,
  formData: FormData
): Promise<ChangeRequestState> {
  const message = String(formData.get("message") ?? "").trim();
  const tenantSlug = String(formData.get("tenantSlug") ?? "");

  if (message.length < 10) {
    return { error: "Tell us a little more about what you need.", ok: false };
  }
  if (message.length > 4000) {
    return { error: "That is too long. Please keep it under 4000 characters.", ok: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again.", ok: false };

  // Resolve the tenant from the slug rather than trusting an id from the form.
  // RLS scopes this select, so a slug the user has no membership for returns
  // nothing and the insert never happens.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!tenant) return { error: "That agency could not be found.", ok: false };

  const { error } = await supabase.from("change_requests").insert({
    tenant_id: tenant.id,
    user_id: user.id,
    message,
  });

  if (error) {
    return { error: "That request could not be sent. Try again.", ok: false };
  }

  revalidatePath(`/app/${tenantSlug}/agent`);
  return { error: null, ok: true };
}
