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
 * on 2026-08-29. Three differences from Retell that shape this file:
 *
 * 1. NO RECORDING IN THE PAYLOAD. There is no audio or recording URL field at
 *    all. Recordings come from a separate endpoint,
 *      GET /api/analytics/v1/{org}/{workspace}/{app}/recordings/{interaction_id}
 *    whose documented example response is still literally `{}` as of a re-read
 *    on 2026-08-29 — the return shape is unknown until called with real
 *    credentials. lib/recordings.ts therefore accepts any of the three shapes
 *    such an endpoint plausibly returns, and scripts/probe-sarvam.mjs settles
 *    the question outright once a key exists. Until then the audio player
 *    degrades to "No recording stored for this call", which is honest.
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
  attempt_id?: string;
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
};

function normaliseTranscript(
  payload: SarvamWebhookPayload,
  callerName: string | null
): TranscriptTurn[] {
  const turns = payload.interaction_transcript;
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
  // attempt_id is the per-attempt identifier and is present even when the call
  // never connected; interaction_id is null in that case. attempt_id is
  // therefore the correct idempotency key.
  if (!payload.attempt_id || !payload.app_id) return null;

  const vars = payload.final_agent_variables ?? undefined;
  const analysis = extractAnalysis(vars);
  const durationSeconds = Math.round(Number(payload.duration ?? 0));

  const callerName =
    typeof vars?.caller_name === "string" && vars.caller_name.trim()
      ? (vars.caller_name as string).trim()
      : null;

  // A call that never connected is not a voicemail and not a lead — it never
  // reached a person or an answering machine. Recording it as not_a_fit keeps
  // it out of the pipeline while still showing in the log.
  const connected = payload.connectivity_status === "connected";
  const outcome = connected
    ? inferOutcome(vars?.outcome, analysis, durationSeconds)
    : "not_a_fit";

  return {
    provider: "sarvam",
    providerCallId: payload.attempt_id,
    providerAgentId: payload.app_id,
    callerName,
    callerPhone: payload.user_phone_number ?? null,
    startedAt: payload.executed_at
      ? new Date(payload.executed_at).toISOString()
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
