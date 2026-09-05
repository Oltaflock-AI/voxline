import type { TranscriptTurn } from "@/lib/calls";
import {
  extractAnalysis,
  inferOutcome,
  type NormalisedCall,
} from "@/lib/ingest";

/**
 * ============================================================================
 * Sarvam Voice Agents adapter.
 * ============================================================================
 *
 * Verified against docs.sarvam.ai/conversations/api/campaigns/webhook-payload
 * and a real inbound `on_end` delivery on 2026-08-31. Three differences from
 * Retell that shape this file:
 *
 * 1. NO RECORDING IN THE PAYLOAD. There is no audio or recording URL field at
 *    all. Recordings come from a separate endpoint,
 *      GET /api/analytics/v1/{org}/{workspace}/{app}/recordings/{interaction_id}
 *    whose documented example response is still literally `{}`. A real inbound
 *    request on 2026-08-31 settled the shape: HTTP 200, `audio/wav`, raw RIFF
 *    bytes. lib/recordings.ts accepts that response directly.
 *
 * 2. NO SIGNATURE. Sarvam documents no HMAC, no secret header, nothing. The
 *    route authenticates on an unguessable per-agent token in the URL instead
 *    — see the note in 20260829130000_generalise_provider.sql.
 *
 * 3. NO TRANSCRIPT TIMESTAMPS. Turns are `{ role, en_text }` only. We derive
 *    `ts` from turn order so the shape stays consistent with Retell's, but the
 *    numbers are ordinal, not seconds. Nothing in the UI currently displays
 *    them; if a "jump to this point in the audio" feature is ever built, this
 *    is where it breaks for Sarvam.
 */

export type SarvamWebhookPayload = {
  app_id?: string;
  app_version?: number;
  attempt_id?: string | null;
  interaction_id?: string | null;
  campaign_id?: string | null;
  completion_status?: string | null;
  connectivity_status?: string | null;
  failure_reason?: string | null;
  user_phone_number?: string | null;
  agent_phone_number?: string | null;
  /** Seconds, and a float — 42.5 in Sarvam's own example. */
  duration?: number | null;
  executed_at?: string | null;
  initial_agent_variables?: Record<string, unknown> | null;
  final_agent_variables?: Record<string, unknown> | null;
  interaction_transcript?: { role?: string; en_text?: string }[] | null;
  metadata?: Record<string, unknown> | null;

  // Agent-level `on_end` hook fields. Unlike the campaign webhook above,
  // inbound calls have no attempt_id or campaign_id; interaction_id is their
  // stable call identity. These names and types are from a real delivery.
  outcome?: string | null;
  caller_name?: string | null;
  destination?: string | null;
  dates?: string | null;
  party_size?: string | number | null;
  budget?: string | number | null;
  occasion?: string | null;
  notes?: string | null;
  call_summary?: string | null;
  user_identifier?: string | null;
  user_identifier_type?: string | null;
  conversation_language?: string | null;
  call_transcript?: { role?: string; en_text?: string }[] | null;
  call_start_time?: string | null;
  call_end_time?: string | null;
  call_length_seconds?: number | null;
};

function normaliseTranscript(
  payload: SarvamWebhookPayload,
  callerName: string | null
): TranscriptTurn[] {
  const turns = payload.interaction_transcript ?? payload.call_transcript;
  if (!Array.isArray(turns)) return [];

  return turns.flatMap((turn, i) => {
    const text = typeof turn.en_text === "string" ? turn.en_text.trim() : "";
    if (!text) return [];
    return [
      {
        // "Agent" exactly, because the Transcript component keys its styling
        // off that literal. Sarvam sends "agent" / "user".
        speaker: turn.role === "agent" ? "Agent" : (callerName ?? "Caller"),
        text,
        ts: i, // ordinal, not seconds — Sarvam sends no timing
      },
    ];
  });
}

/**
 * Turn a Sarvam webhook body into the shape ingestCall() expects.
 * Returns null when the payload is not something we can act on.
 */
export function normaliseSarvamCall(
  payload: SarvamWebhookPayload
): NormalisedCall | null {
  // Campaigns identify every dial attempt, including failures, by attempt_id.
  // Inbound on_end hooks have no attempt_id; interaction_id is their stable id.
  const providerCallId = payload.attempt_id ?? payload.interaction_id;
  if (!providerCallId || !payload.app_id) return null;

  // THREE PAYLOAD SHAPES REACH THIS FUNCTION, and they disagree about
  // everything except that a call happened.
  //
  //   campaign webhook   final_agent_variables{}, duration, connectivity_status
  //   on_end HTTPS tool  fields at the top level, call_length_seconds
  //   inbound webhook_config  fields at the top level, `duration`, and NEITHER
  //                      call_length_seconds NOR connectivity_status
  //
  // The third only appeared on 2026-09-05, when Voxline first set
  // `webhook_config` on an inbound deployment. It looked like the second but
  // carries `duration`, so `call_length_seconds !== undefined` was false, the
  // call was treated as never-connected, and a real 102-second conversation
  // with a full transcript was filed as `not_a_fit` with an empty trip brief.
  //
  // So the variable bag is now the payload itself whenever a separate bag is
  // absent, rather than only when one particular duration field is present.
  // extractAnalysis picks six known keys and ignores everything else, so
  // handing it the whole payload cannot pull in anything unintended.
  const vars = payload.final_agent_variables ?? payload;
  const analysis = extractAnalysis(vars);
  const durationSeconds = Math.round(
    Number(payload.duration ?? payload.call_length_seconds ?? 0)
  );

  const callerName =
    typeof payload.caller_name === "string" && payload.caller_name.trim()
      ? payload.caller_name.trim()
      : typeof vars?.caller_name === "string" && vars.caller_name.trim()
        ? (vars.caller_name as string).trim()
      : null;

  // A call that never connected is not a voicemail and not a lead — it never
  // reached a person or an answering machine. Recording it as not_a_fit keeps
  // it out of the pipeline while still showing in the log.
  //
  // Only the campaign payload reports connectivity, and only it can describe a
  // dial that never connected. Absence of that field is therefore not evidence
  // of a failed call: both post-call shapes omit it and only ever describe
  // calls that happened. Treating absence as "not connected" is what discarded
  // the 2026-09-05 inbound call's trip brief.
  const connected =
    payload.connectivity_status === undefined ||
    payload.connectivity_status === "connected";
  const outcome = connected
    ? inferOutcome(vars?.outcome, analysis, durationSeconds)
    : "not_a_fit";

  return {
    provider: "sarvam",
    providerCallId,
    providerAgentId: payload.app_id,
    callerName,
    callerPhone:
      payload.user_phone_number ??
      (payload.user_identifier_type === "phone_number"
        ? payload.user_identifier
        : null),
    startedAt: payload.executed_at || payload.call_start_time
      ? new Date(payload.executed_at ?? payload.call_start_time!).toISOString()
      : undefined,
    durationSeconds,
    // See note 1 above — the webhook carries no audio, so this points at the
    // analytics endpoint instead. `interaction_id` is null when the call never
    // connected, and there is nothing to fetch in that case anyway.
    recording: payload.interaction_id
      ? {
          kind: "sarvam",
          appId: payload.app_id,
          interactionId: payload.interaction_id,
        }
      : undefined,
    transcript: normaliseTranscript(payload, callerName),
    analysis: connected ? analysis : undefined,
    outcome,
    // Sarvam sends one webhook per completed attempt, so this is always the
    // final word on duration. (Unlike Retell, which splits call_ended and
    // call_analyzed across two deliveries.)
    isFinal: true,
  };
}
