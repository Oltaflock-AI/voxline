import crypto from "node:crypto";
import type { TranscriptTurn } from "@/lib/calls";
import {
  extractAnalysis,
  inferOutcome,
  type NormalisedCall,
} from "@/lib/ingest";

/**
 * ============================================================================
 * Retell AI adapter.
 * ============================================================================
 *
 * Retell is the runtime named in spec §3. Sarvam is the second provider (see
 * ./sarvam.ts); both normalise into the same shape so lib/ingest.ts holds the
 * hard logic once.
 *
 * Unlike Sarvam, Retell signs its webhooks and includes a recording URL, and
 * splits one call across two events (`call_ended`, then `call_analyzed`).
 */

/**
 * Verify a Retell webhook signature.
 *
 * Spec §8 lists this under "never cut". Without it the endpoint is an
 * unauthenticated public writer into the `calls` table.
 *
 * timingSafeEqual, not `===`. A normal string comparison returns as soon as it
 * finds a differing byte, so how long it takes leaks how much of the prefix
 * was right; enough samples and you can recover a valid signature a byte at a
 * time.
 */
export function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");

  // timingSafeEqual throws on a length mismatch, and a signature's length is
  // not a secret, so check it first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type RetellCallPayload = {
  call_id?: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  recording_url?: string;
  transcript?: string;
  transcript_object?: {
    role?: string;
    content?: string;
    words?: { start?: number }[];
  }[];
  call_analysis?: {
    custom_analysis_data?: Record<string, unknown>;
    call_summary?: string;
    user_sentiment?: string;
  };
};

export type RetellWebhookEvent = {
  event?: string;
  call?: RetellCallPayload;
};

function normaliseTranscript(
  payload: RetellCallPayload,
  callerName: string | null
): TranscriptTurn[] {
  const objects = payload.transcript_object;
  if (!Array.isArray(objects)) return [];

  return objects.flatMap((turn) => {
    const text = typeof turn.content === "string" ? turn.content.trim() : "";
    if (!text) return [];
    return [
      {
        // "Agent" exactly — the Transcript component keys its styling off that
        // literal, and the caller's own name reads better than "user".
        speaker: turn.role === "agent" ? "Agent" : (callerName ?? "Caller"),
        text,
        ts: Math.round(turn.words?.[0]?.start ?? 0),
      },
    ];
  });
}

/** Events worth acting on. `call_started` carries nothing we store. */
export function isIngestableRetellEvent(event: string) {
  return event === "call_ended" || event === "call_analyzed";
}

export function normaliseRetellCall(
  event: RetellWebhookEvent
): NormalisedCall | null {
  const call = event.call;
  if (!call?.call_id || !call.agent_id) return null;

  const vars = call.call_analysis?.custom_analysis_data;
  const analysis = extractAnalysis(vars, call.call_analysis?.call_summary);
  const durationSeconds = Math.round((call.duration_ms ?? 0) / 1000);

  const callerName =
    typeof vars?.caller_name === "string" && vars.caller_name.trim()
      ? (vars.caller_name as string).trim()
      : null;

  const transcript = normaliseTranscript(call, callerName);

  return {
    provider: "retell",
    providerCallId: call.call_id,
    providerAgentId: call.agent_id,
    callerName,
    callerPhone: call.from_number ?? null,
    startedAt: call.start_timestamp
      ? new Date(call.start_timestamp).toISOString()
      : undefined,
    durationSeconds,
    // Spec §8: recordings live in a private bucket. Retell's `recording_url`
    // is a temporary PUBLIC link, so it is a source to download FROM, never a
    // value to store — keeping it would leave a reachable recording of a real
    // phone call in our database. ingest.ts copies it into the bucket.
    recording: call.recording_url
      ? { kind: "url", url: call.recording_url }
      : undefined,
    transcript: transcript.length > 0 ? transcript : undefined,
    analysis: call.call_analysis ? analysis : undefined,
    outcome: inferOutcome(vars?.outcome, analysis, durationSeconds),
    // Only call_ended reports final duration. Billing on call_analyzed too
    // would charge every caller twice.
    isFinal: event.event === "call_ended",
  };
}
