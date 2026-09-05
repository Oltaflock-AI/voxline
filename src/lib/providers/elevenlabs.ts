import type { NormalisedCall } from "@/lib/ingest";
import { extractAnalysis, inferOutcome } from "@/lib/ingest";
import type { TranscriptTurn } from "@/lib/calls";

/**
 * ============================================================================
 * ElevenLabs — the fourth provider. Adapter only; ingestCall() does the rest.
 * ============================================================================
 *
 * Two live clients are already on it: Rise & Shine Travels runs one agent, and
 * Sarthak Singapore runs three, one per property. Brief task 3.
 *
 * WHAT MAKES ELEVENLABS DIFFERENT FROM THE OTHER THREE
 *
 * 1. THREE EVENT TYPES, AND TWO OF THEM MATTER.
 *      post_call_transcription   the conversation, transcript and analysis
 *      post_call_audio           metadata plus `full_audio`, base64 MP3
 *      call_initiation_failure   telephony failures — busy, no answer
 *    Vapi sends a dozen and exactly one counts. Here the transcript and the
 *    audio arrive as SEPARATE deliveries, so an adapter that handles only the
 *    transcript silently gets no recording.
 *
 *    We ingest `post_call_transcription` and fetch audio on demand instead of
 *    reading `post_call_audio` (see the recording note below).
 *
 * 2. DATA COLLECTION IS WRAPPED. `analysis.data_collection_results` is keyed by
 *    field name — good — but each entry is an object:
 *
 *      { destination: { value: "Bali", rationale: "caller said…" }, … }
 *
 *    so it has to be unwrapped before extractAnalysis() sees it. Vapi wraps by
 *    output ID and needs the same treatment for a different reason.
 *
 * 3. IT SIGNS ITS DELIVERIES, unlike Sarvam and Vapi. The route verifies the
 *    HMAC; this file stays pure.
 *
 * SHAPE VERIFIED against the Sarthak Singapore edge function
 * (Oltaflock-AI/sarthak-singapore, supabase/functions/elevenlabs-webhook),
 * which has been consuming these exact fields in production since July 2026.
 * That is stronger evidence than the published docs, which do not describe the
 * envelope in this much detail.
 */

type CollectedEntry = { value?: unknown; rationale?: string };

export type ElevenLabsWebhookPayload = {
  type?: string;
  event_timestamp?: number;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    transcript?: {
      role?: string;
      message?: string | null;
      time_in_call_secs?: number;
    }[];
    metadata?: {
      call_duration_secs?: number | string;
      start_time_unix_secs?: number;
      termination_reason?: string;
      phone_call?: {
        direction?: string;
        external_number?: string | null;
        to_number?: string | null;
        from_number?: string | null;
      } | null;
    } | null;
    analysis?: {
      transcript_summary?: string | null;
      call_successful?: string | null;
      data_collection_results?: Record<string, CollectedEntry | unknown> | null;
    } | null;
    conversation_initiation_client_data?: {
      dynamic_variables?: Record<string, unknown> | null;
    } | null;
  } | null;
};

/** The only event that carries a finished conversation. */
export const ELEVENLABS_FINAL_EVENT = "post_call_transcription";

/** Telephony failure — a real call attempt that never connected. */
export const ELEVENLABS_FAILURE_EVENT = "call_initiation_failure";

/**
 * Rise & Shine's LIVE agent names three fields differently from every other
 * agent Voxline reads, and this is the one place that difference is absorbed.
 *
 * TEMPORARY, AND DATED. Task 4 rebuilds that agent on Sarvam with Voxline's
 * own field names, at which point new calls arrive correctly named and this
 * table only serves history. Delete it once their ElevenLabs calls stop
 * mattering — and do not add to it: the house rule is that the prompt, the
 * column and the reader share one set of names, because the alternative is
 * exactly the silent-empty-field bug this codebase already shipped once.
 *
 * It exists at all because the alternative was a backfill in which every
 * historical Rise & Shine call has an empty trip brief, which would make the
 * backfill pointless.
 *
 *   travel_period    -> dates
 *   num_travellers   -> party_size
 *   special_requests -> notes
 */
const LEGACY_FIELD_ALIASES: Record<string, string> = {
  travel_period: "dates",
  num_travellers: "party_size",
  special_requests: "notes",
};

/**
 * `{ name: { value, rationale } }` → `{ name: value }`, plus the legacy names.
 *
 * A canonical key already present always wins over an alias, so the day the
 * agent starts emitting `dates` itself, this table stops having any effect
 * without anyone having to remember to remove it first.
 */
function flatten(
  results: Record<string, CollectedEntry | unknown> | null | undefined
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const aliased: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(results ?? {})) {
    const value =
      entry && typeof entry === "object" && "value" in entry
        ? (entry as CollectedEntry).value
        : entry;
    if (value === undefined || value === null || value === "") continue;

    flat[key] = value;
    const alias = LEGACY_FIELD_ALIASES[key];
    if (alias) aliased[alias] = value;
  }

  return { ...aliased, ...flat };
}

/**
 * ElevenLabs' transcript into ours.
 *
 * Roles are "agent" and "user". `time_in_call_secs` is real timing and is kept
 * when present; the index is the fallback so turns never all collapse to 0.
 */
function normaliseTranscript(
  payload: ElevenLabsWebhookPayload,
  callerName: string | null
): TranscriptTurn[] | undefined {
  const turns = payload.data?.transcript;
  if (!Array.isArray(turns) || turns.length === 0) return undefined;

  const out: TranscriptTurn[] = [];
  turns.forEach((t, i) => {
    const isAgent = /agent|assistant|bot/i.test(String(t.role ?? ""));
    const text = (t.message ?? "").trim();
    if (!text) return;
    out.push({
      // "Agent" exactly — the Transcript component keys its styling off that
      // literal string.
      speaker: isAgent ? "Agent" : (callerName ?? "Caller"),
      text,
      ts:
        typeof t.time_in_call_secs === "number"
          ? Math.round(t.time_in_call_secs)
          : i,
    });
  });

  return out.length ? out : undefined;
}

/**
 * Which side of the call is the lead.
 *
 * Outbound (Rise & Shine reactivating a lead, Sarthak calling a warm one) the
 * human is the number we dialled; inbound they are the number that rang us.
 * Getting this backwards writes the agency's own line into `caller_phone` on
 * every row.
 */
function leadPhone(payload: ElevenLabsWebhookPayload): string | null {
  const phone = payload.data?.metadata?.phone_call;
  if (!phone) return null;
  const direction = String(phone.direction ?? "outbound").toLowerCase();
  return direction === "inbound"
    ? (phone.from_number ?? phone.external_number ?? null)
    : (phone.external_number ?? phone.to_number ?? null);
}

/**
 * Turn a post-call delivery into the shape ingestCall() expects.
 * Returns null when this is not a finished call we can act on.
 */
export function normaliseElevenLabsCall(
  payload: ElevenLabsWebhookPayload
): NormalisedCall | null {
  const type = payload.type;
  if (type !== ELEVENLABS_FINAL_EVENT && type !== ELEVENLABS_FAILURE_EVENT) {
    return null;
  }

  const data = payload.data;
  const providerCallId = data?.conversation_id;
  const providerAgentId = data?.agent_id;
  if (!providerCallId || !providerAgentId) return null;

  const dynamic = data?.conversation_initiation_client_data?.dynamic_variables ?? {};
  const vars = flatten(data?.analysis?.data_collection_results);
  const analysis = extractAnalysis(vars, data?.analysis?.transcript_summary ?? null);

  const rawDuration = data?.metadata?.call_duration_secs;
  const durationSeconds = Math.max(
    0,
    Math.round(
      typeof rawDuration === "number"
        ? rawDuration
        : Number(rawDuration ?? 0) || 0
    )
  );

  // The name the agent extracted beats the one the dialler was given: a
  // campaign row can be stale, and the caller just said their own name.
  const collectedName = vars.caller_name ?? vars.lead_name;
  const callerName =
    typeof collectedName === "string" && collectedName.trim()
      ? collectedName.trim()
      : typeof dynamic.callee_name === "string" && dynamic.callee_name.trim()
        ? (dynamic.callee_name as string).trim()
        : null;

  const startedAtUnix = data?.metadata?.start_time_unix_secs;

  // A call that never connected: no transcript, no audio, nothing extracted.
  // Recorded anyway, because "we tried and they were busy" is information the
  // agency acts on — and because an unrecorded attempt looks like a call that
  // was never placed.
  if (type === ELEVENLABS_FAILURE_EVENT) {
    return {
      provider: "elevenlabs",
      providerCallId,
      providerAgentId,
      callerName,
      callerPhone: leadPhone(payload),
      startedAt: startedAtUnix
        ? new Date(startedAtUnix * 1000).toISOString()
        : undefined,
      durationSeconds: 0,
      outcome: "voicemail",
      isFinal: true,
    };
  }

  return {
    provider: "elevenlabs",
    providerCallId,
    providerAgentId,
    callerName,
    callerPhone: leadPhone(payload),
    startedAt: startedAtUnix
      ? new Date(startedAtUnix * 1000).toISOString()
      : undefined,
    durationSeconds,
    // Audio is FETCHED, not read from the payload. `post_call_audio` carries
    // the MP3 inline as base64 on a separate delivery, and taking that route
    // would fail exactly on the longest calls: base64 inflates by a third and
    // the platform rejects an oversized request body before any code runs, so
    // audio would go missing on the highest-scoring leads. Backfilled
    // conversations never re-emit that event either, so the fetch path is
    // needed regardless. See lib/recordings.ts.
    recording: { kind: "elevenlabs", conversationId: providerCallId },
    transcript: normaliseTranscript(payload, callerName),
    analysis,
    // `outcome` is the agent's own data-collection field where one is
    // configured. Rise & Shine's agent instead emits `lead_qualified`, a
    // boolean, so it is folded in here rather than left to the duration
    // heuristic. inferOutcome() still validates and falls back.
    outcome: inferOutcome(
      vars.outcome ?? qualifiedFlagToOutcome(vars.lead_qualified),
      analysis,
      durationSeconds
    ),
    // One transcription event per conversation, so this is always the final
    // word on duration.
    isFinal: true,
  };
}

/** Rise & Shine's `lead_qualified` boolean, as an outcome the enum knows. */
function qualifiedFlagToOutcome(flag: unknown): string | undefined {
  if (flag === true || flag === "true") return "inquiry_captured";
  if (flag === false || flag === "false") return "not_a_fit";
  return undefined;
}
