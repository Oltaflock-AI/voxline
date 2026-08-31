"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Mint a short-lived signed URL for a call recording.
 *
 * Spec §8: recordings live in a private bucket and are served through
 * short-lived signed URLs. The URL is generated on demand rather than baked
 * into the page, so a stale HTML page (or a shared screenshot of the DOM)
 * cannot hand someone a working link an hour later.
 *
 * Ownership is enforced twice on purpose:
 *   1. the `calls` lookup runs on the user's own client, so RLS filters it
 *   2. the storage policy in 20260828120200_storage.sql re-checks the tenant
 *      from the object path
 * Either alone would do. Both means a bug in one is not a breach.
 */
export async function getRecordingUrl(
  callId: string
): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();

  const { data: call } = await supabase
    .from("calls")
    .select("recording_path")
    .eq("id", callId)
    .maybeSingle();

  // Either the call is not ours (RLS hid it) or there is no recording.
  // Same response for both — we do not confirm the row exists.
  if (!call?.recording_path) {
    return { url: null, error: "No recording is available for this call." };
  }

  const { data, error } = await supabase.storage
    .from("recordings")
    .createSignedUrl(call.recording_path, 300); // 5 minutes

  if (error || !data) {
    return { url: null, error: "That recording could not be opened." };
  }

  return { url: data.signedUrl, error: null };
}
