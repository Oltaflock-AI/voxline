import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { storeRecording } from "@/lib/recordings";

export type RecordingStatus = "pending" | "ready" | "unavailable" | "failed";

const RETRY_WINDOW_MS = 10 * 60 * 1000;
const BACKOFF_SECONDS = [5, 15, 30, 60, 120];

/**
 * Retry only the secondary recording asset. Call ingestion, lead creation and
 * minute billing must never run again just because Sarvam prepared its WAV a
 * few seconds after the on_end hook.
 *
 * This is safe to call from the open-row poller today and from a scheduled
 * worker later. `recording_next_retry_at` prevents every browser poll from
 * hitting Sarvam while a retry is already in flight.
 */
export async function retrySarvamRecording(
  callId: string,
  force = false
): Promise<RecordingStatus> {
  const db = createAdminClient();
  const { data: call } = await db
    .from("calls")
    .select(
      "id, tenant_id, voice_agent_id, provider, provider_call_id, recording_path, recording_status, recording_attempts, recording_first_attempt_at, recording_next_retry_at"
    )
    .eq("id", callId)
    .maybeSingle();

  if (!call) return "unavailable";
  if (call.recording_path) {
    if (call.recording_status !== "ready") {
      await db
        .from("calls")
        .update({ recording_status: "ready", recording_next_retry_at: null })
        .eq("id", call.id);
    }
    return "ready";
  }
  if (call.provider !== "sarvam" || !call.voice_agent_id) return "unavailable";
  if (call.recording_status === "failed" && !force) return "failed";

  const now = Date.now();
  const firstAttempt = new Date(
    call.recording_first_attempt_at ?? new Date(now).toISOString()
  ).getTime();
  const retryWindowExpired = now - firstAttempt >= RETRY_WINDOW_MS;

  if (
    !force &&
    call.recording_next_retry_at &&
    new Date(call.recording_next_retry_at).getTime() > now
  ) {
    return "pending";
  }

  const attempt = call.recording_attempts + 1;
  // Claim a short window before doing network I/O. Duplicate attempts are
  // harmless (storage upserts), but this keeps two open browser tabs polite.
  await db
    .from("calls")
    .update({
      recording_status: "pending",
      recording_attempts: attempt,
      recording_first_attempt_at:
        call.recording_first_attempt_at ?? new Date(now).toISOString(),
      recording_next_retry_at: new Date(now + 30_000).toISOString(),
    })
    .eq("id", call.id);

  const { data: agent } = await db
    .from("voice_agents")
    .select("provider_agent_id")
    .eq("id", call.voice_agent_id)
    .maybeSingle();

  if (!agent?.provider_agent_id) {
    await db
      .from("calls")
      .update({
        recording_status: "failed",
        recording_next_retry_at: null,
        recording_last_error: "Voice agent mapping is missing",
      })
      .eq("id", call.id);
    return "failed";
  }

  const path = await storeRecording({
    source: {
      kind: "sarvam",
      appId: agent.provider_agent_id,
      interactionId: call.provider_call_id,
    },
    tenantId: call.tenant_id,
    provider: "sarvam",
    providerCallId: call.provider_call_id,
  });

  if (path) {
    await db
      .from("calls")
      .update({
        recording_path: path,
        recording_status: "ready",
        recording_next_retry_at: null,
        recording_last_error: null,
      })
      .eq("id", call.id);
    return "ready";
  }

  // Make one final provider request when the retry window expires. Otherwise
  // a call first opened after ten minutes would be labelled failed without
  // checking the recording that Sarvam may have prepared in the meantime.
  if (retryWindowExpired) {
    await db
      .from("calls")
      .update({
        recording_status: "failed",
        recording_next_retry_at: null,
        recording_last_error: "Recording was not available within 10 minutes",
      })
      .eq("id", call.id);
    return "failed";
  }

  const delay = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
  await db
    .from("calls")
    .update({
      recording_status: "pending",
      recording_next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
      recording_last_error: "Provider recording is not ready",
    })
    .eq("id", call.id);
  return "pending";
}
