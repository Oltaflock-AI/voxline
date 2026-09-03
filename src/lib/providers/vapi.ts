import type { NormalisedCall } from "@/lib/ingest";
import { extractAnalysis, inferOutcome } from "@/lib/ingest";
import type { TranscriptTurn } from "@/lib/calls";

/**
 * ============================================================================
 * Vapi — the third provider. Adapter only; ingestCall() does the rest.
 * ============================================================================
 *
 * WHAT MAKES VAPI DIFFERENT FROM THE OTHER TWO
 *
 * 1. One URL, many event types. Vapi posts `status-update`, `transcript`,
 *    `conversation-update`, `speech-update`, `tool-calls`, `hang` and more to
 *    the same server URL as the end-of-call report. Everything except
 *    `end-of-call-report` must be accepted and ignored — answering 500 to an
 *    event we do not handle makes Vapi retry it forever.
 *
 * 2. Structured outputs are keyed by OUTPUT ID, not by field name:
 *
 *      "02d20a3e-…": { name: "outcome",     result: "inquiry_captured" }
 *      "80e753f3-…": { name: "destination", result: "Bali" }
 *
 *    So the ids are useless to us and the names are what matter. `flatten()`
 *    below turns that into the plain `{ destination: "Bali" }` bag that
 *    extractAnalysis() already understands — which is why the eight outputs on
 *    the Vapi assistant are named to match `calls.analysis` exactly. Verified
 *    against a real call on 2026-09-03; the id → name shape is the reason this
 *    cannot simply read `structuredData.destination` the way Sarvam does.
 *
 * 3. The recording arrives as a plain URL in the payload, so this reuses
 *    `{ kind: "url" }` like Retell. None of Sarvam's separate-analytics-
 *    endpoint machinery is needed.
 *
 * ENVELOPE, VERIFIED. Checked against all 12 real calls on the assistant on
 * 2026-09-03 with scripts/backfill-vapi.mjs, which reports which branch each
 * payload actually needs. Every one of them:
 *
 *   recording        artifact.recordingUrl        12/12
 *   structured data  artifact.structuredOutputs   12/12
 *
 * So the `artifact.recording.url` / `analysis.structuredData` fallbacks this
 * file used to carry never fired once, and they are gone. A fallback that
 * never fires is a lie about what the provider sends, and it hides a real
 * change of shape behind a silent second guess. Re-run that script after any
 * Vapi upgrade; if a branch it reports is missing here, add it back knowingly.
 */

type StructuredOutput = { name?: string; result?: unknown };

export type VapiWebhookPayload = {
  message?: {
    type?: string;
    endedReason?: string;
    durationSeconds?: number;
    startedAt?: string;
    endedAt?: string;
    call?: {
      id?: string;
      assistantId?: string;
      customer?: { number?: string | null; name?: string | null } | null;
    } | null;
    assistant?: { id?: string; name?: string } | null;
    customer?: { number?: string | null; name?: string | null } | null;
    artifact?: {
      recordingUrl?: string | null;
      transcript?: string | null;
      messages?: { role?: string; message?: string; content?: string; secondsFromStart?: number }[];
      structuredOutputs?: Record<string, StructuredOutput> | null;
    } | null;
    /** Vapi's own summary. Used only as the notes fallback. */
    analysis?: { summary?: string | null } | null;
  };
};

/** The only event that describes a finished call. Everything else is noise. */
export const VAPI_FINAL_EVENT = "end-of-call-report";

/**
 * `{ "<uuid>": { name, result } }` → `{ [name]: result }`.
 *
 * Entries without a name are dropped rather than keyed by their id: an output
 * we cannot name is an output we cannot map to a column, and inventing a key
 * from the uuid would put an unreadable field into the trip brief.
 */
function flatten(
  outputs: Record<string, StructuredOutput> | null | undefined
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of Object.values(outputs ?? {})) {
    if (entry && typeof entry.name === "string" && entry.name.trim()) {
      flat[entry.name.trim()] = entry.result;
    }
  }
  return flat;
}

/**
 * Vapi's message list into our turns.
 *
 * Vapi labels the agent "bot" and includes system and tool rows; only the two
 * spoken roles belong in a transcript a person reads. `secondsFromStart` is
 * real timing, unlike Sarvam's, so it is kept when present.
 */
function normaliseTranscript(
  payload: VapiWebhookPayload,
  callerName: string | null
): TranscriptTurn[] | undefined {
  const messages = payload.message?.artifact?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  const turns: TranscriptTurn[] = [];
  messages.forEach((m, i) => {
    const isAgent = m.role === "bot" || m.role === "assistant";
    const isCaller = m.role === "user";
    if (!isAgent && !isCaller) return; // system prompts and tool calls are not conversation
    const text = (m.message ?? m.content ?? "").trim();
    if (!text) return;
    turns.push({
      // "Agent" exactly, because the Transcript component keys its styling off
      // that literal. Vapi labels its own side "bot".
      speaker: isAgent ? "Agent" : (callerName ?? "Caller"),
      text,
      ts: typeof m.secondsFromStart === "number" ? Math.round(m.secondsFromStart) : i,
    });
  });

  return turns.length ? turns : undefined;
}

/**
 * Turn a Vapi end-of-call report into the shape ingestCall() expects.
 * Returns null when the payload is not a finished call we can act on.
 */
export function normaliseVapiCall(
  payload: VapiWebhookPayload
): NormalisedCall | null {
  const m = payload.message;
  if (!m || m.type !== VAPI_FINAL_EVENT) return null;

  const providerCallId = m.call?.id;
  // The assistant is the tenant key. `assistant.id` is the documented home;
  // `call.assistantId` is where it sits on some payloads.
  const providerAgentId = m.assistant?.id ?? m.call?.assistantId;
  if (!providerCallId || !providerAgentId) return null;

  const vars = flatten(m.artifact?.structuredOutputs);
  const analysis = extractAnalysis(vars, m.analysis?.summary ?? null);

  const durationSeconds = Math.round(
    typeof m.durationSeconds === "number"
      ? m.durationSeconds
      : m.startedAt && m.endedAt
        ? (Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000
        : 0
  );

  const rawName = vars.caller_name;
  const callerName =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim()
      : (m.call?.customer?.name ?? m.customer?.name ?? null);

  const recordingUrl = m.artifact?.recordingUrl ?? null;

  return {
    provider: "vapi",
    providerCallId,
    providerAgentId,
    callerName,
    callerPhone: m.call?.customer?.number ?? m.customer?.number ?? null,
    startedAt: m.startedAt ? new Date(m.startedAt).toISOString() : undefined,
    durationSeconds,
    recording: recordingUrl ? { kind: "url", url: recordingUrl } : undefined,
    transcript: normaliseTranscript(payload, callerName),
    analysis,
    // The assistant emits `outcome` as one of the four enum values, so this
    // usually passes straight through. inferOutcome() still runs, because an
    // extraction can be skipped by its own conditions or return null, and a
    // call with a destination and dates is a lead whatever the field says.
    outcome: inferOutcome(vars.outcome, analysis, durationSeconds),
    // One end-of-call report per call, so this is always the final word on
    // duration. Unlike Retell, which splits it across two deliveries.
    isFinal: true,
  };
}
