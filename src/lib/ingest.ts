import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  BRIEF_FIELDS,
  LEAD_FALLBACK_SUMMARY,
  type AgentVertical,
  type CallAnalysis,
  type TranscriptTurn,
} from "@/lib/calls";
import { OUTCOMES_BY_VERTICAL } from "@/lib/outcomes";
import { storeRecording, type RecordingSource } from "@/lib/recordings";
import { retrySarvamRecording } from "@/lib/recording-retry";

export type VoiceProvider = Database["public"]["Enums"]["voice_provider"];
export type CallOutcome = Database["public"]["Enums"]["call_outcome"];

/**
 * ============================================================================
 * Provider-agnostic call ingestion.
 * ============================================================================
 *
 * Every voice provider sends a differently-shaped post-call payload. Retell
 * signs its webhooks and includes a recording URL; Sarvam does neither, names
 * everything differently, and omits transcript timestamps.
 *
 * Rather than fork the handler per provider, each provider gets a thin adapter
 * (lib/providers/*.ts) whose only job is to turn its payload into the
 * `NormalisedCall` below. Everything that is actually hard — idempotency,
 * field merging across events, lead creation, minute claiming — lives here and
 * is written once.
 *
 * That matters because the hard parts are where the bugs were: minutes were
 * double-billed on retry, a sparse follow-up event blanked fields the first
 * one set, and concurrent deliveries raced to create duplicate leads. Those
 * fixes should not have to be re-made for every provider we add.
 */

export type NormalisedCall = {
  provider: VoiceProvider;
  /** The provider's own id for this call. Idempotency key. */
  providerCallId: string;
  /** The provider's own id for the agent, mapped to a tenant via voice_agents. */
  providerAgentId: string;

  /** Fields below are optional: absent means "this event didn't carry it", */
  /** which is different from "it is empty" and must not overwrite. */
  callerName?: string | null;
  callerPhone?: string | null;
  startedAt?: string;
  durationSeconds?: number;
  /**
   * Where the recording can be fetched from, if the provider has one. Absent
   * means this event carried no audio.
   *
   * Adapters report a SOURCE, never a path: the storage policy keys off the
   * first path segment being the tenant id, so that convention lives in
   * lib/recordings.ts alone. See 20260828120200_storage.sql.
   */
  recording?: RecordingSource;
  transcript?: TranscriptTurn[];
  analysis?: CallAnalysis;
  outcome: CallOutcome;

  /** True only for the event that reports final call duration, so minutes are */
  /** billed once even though several events describe the same call. */
  isFinal: boolean;
};

export type IngestResult =
  | { ok: true; callId: string; leadCreated: boolean }
  | { ok: false; status: number; reason: string };

/**
 * Which outcomes are worth a pipeline card.
 *
 * Spec §4 step 3 named the two travel ones. Real estate adds the two that
 * matter most: a booked site visit is the strongest lead the product can
 * produce, and a caller who asked for the team and was transferred is one step
 * behind it. Leaving them out meant the single most valuable outcome created
 * nothing for anyone to follow up.
 */
const LEAD_OUTCOMES: CallOutcome[] = [
  "inquiry_captured",
  "quote_requested",
  "site_visit_booked",
  "transferred_to_human",
];

export function qualifiesAsLead(outcome: CallOutcome) {
  return LEAD_OUTCOMES.includes(outcome);
}

/**
 * The one-line summary shown on a pipeline card.
 *
 * Built from BRIEF_FIELDS rather than a hardcoded list, so a real-estate card
 * reads "Investment · Commercial · 1200 sq ft" instead of the literal string
 * "Trip inquiry", which is what every property lead said before this.
 */
export function buildLeadSummary(
  analysis: CallAnalysis | undefined,
  vertical: AgentVertical
): string {
  const fallback = LEAD_FALLBACK_SUMMARY[vertical];
  if (!analysis) return fallback;
  return (
    BRIEF_FIELDS[vertical]
      .map(([key]) => analysis[key])
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .slice(0, 4)
      .join(" · ") || fallback
  );
}

/**
 * Persist a normalised call. Provider-independent.
 *
 * Runs on the service role, so it bypasses RLS entirely — the caller is
 * responsible for having authenticated the request before getting here.
 */
export async function ingestCall(call: NormalisedCall): Promise<IngestResult> {
  const supabase = createAdminClient();

  // --- resolve the tenant from the agent id, never from the payload --------
  // Spec §11 decision 1: one agent per tenant, and the mapping lives in our
  // database. If a payload could name its own tenant, a forged call could be
  // written into a competitor's portal.
  const { data: agent, error: agentError } = await supabase
    .from("voice_agents")
    .select("id, tenant_id, vertical, credential_ref")
    .eq("provider", call.provider)
    .eq("provider_agent_id", call.providerAgentId)
    .maybeSingle();

  if (agentError) {
    console.error("[ingest] agent lookup failed", agentError);
    // A database problem — worth a retry, so signal failure upward.
    return { ok: false, status: 500, reason: "lookup failed" };
  }
  if (!agent) {
    // Authentic request, unknown agent. Retrying will not conjure the row, so
    // accept it and log loudly rather than making the provider retry forever.
    console.error(
      `[ingest] no voice_agent for ${call.provider}/${call.providerAgentId}`
    );
    return { ok: false, status: 200, reason: "unknown agent" };
  }

  // --- the vertical, snapshotted onto the call -----------------------------
  // Copied onto the row rather than read back off the agent, because
  // `calls.lead_score` is a GENERATED column and a generation expression may
  // reference only its own row — no joins, no subqueries. See the header of
  // 20260906090100_real_estate_vertical.sql. It is also the honest record: a
  // call keeps the vertical it was actually scored under, even if the agent is
  // later switched.
  const vertical = agent.vertical;

  // An adapter cannot know the vertical — it runs before this lookup — so it
  // may hand up an outcome that belongs to the other one. Rather than store a
  // value the filter chips will never show, fold it into the nearest outcome
  // this vertical does have. Logged, because a travel agent emitting
  // `site_visit_booked` means a prompt is configured wrong.
  let outcome = call.outcome;
  if (!OUTCOMES_BY_VERTICAL[vertical].includes(outcome)) {
    console.warn(
      `[ingest] ${call.provider}/${call.providerAgentId} is ${vertical} but emitted "${outcome}" — storing inquiry_captured`
    );
    outcome = "inquiry_captured";
  }

  // --- upsert, merging rather than overwriting -----------------------------
  // Only fields this event actually carries are written. Providers split a
  // call across several events with different subsets — Retell's
  // `call_analyzed` omits duration and recording, for instance — and writing
  // the whole object unconditionally blanked what an earlier event had stored.
  const { data: saved, error: upsertError } = await supabase
    .from("calls")
    .upsert(
      {
        tenant_id: agent.tenant_id,
        voice_agent_id: agent.id,
        provider: call.provider,
        provider_call_id: call.providerCallId,
        outcome,
        vertical,
        ...(call.callerName ? { caller_name: call.callerName } : {}),
        ...(call.callerPhone ? { caller_phone: call.callerPhone } : {}),
        ...(call.startedAt ? { started_at: call.startedAt } : {}),
        ...(call.durationSeconds && call.durationSeconds > 0
          ? { duration_seconds: call.durationSeconds }
          : {}),
        // recording_path is deliberately NOT set here. It is written only
        // after the audio is actually in the bucket, below — setting it on the
        // strength of the payload alone is what produced play controls that
        // returned "Object not found".
        ...(call.transcript && call.transcript.length > 0
          ? { transcript: call.transcript }
          : {}),
        ...(call.analysis ? { analysis: call.analysis } : {}),
      },
      { onConflict: "provider,provider_call_id" }
    )
    .select("id")
    .single();

  if (upsertError || !saved) {
    console.error("[ingest] call upsert failed", upsertError);
    return { ok: false, status: 500, reason: "upsert failed" };
  }

  // --- recording: fetch the audio, THEN record where it lives --------------
  // After the upsert, never before, and never fatal. The call row is the thing
  // the agency needs; the audio is secondary, and a provider whose media
  // endpoint is slow or down must not make it retry the whole delivery — that
  // would re-run everything above for an asset we already failed to get.
  //
  // Skipped entirely when the path is already stored, so a provider retry does
  // not re-download a file we have.
  if (call.recording) {
    const { data: existing } = await supabase
      .from("calls")
      .select("recording_path, recording_status, recording_first_attempt_at")
      .eq("id", saved.id)
      .single();

    if (!existing?.recording_path) {
      await supabase
        .from("calls")
        .update({
          recording_status: "pending",
          recording_first_attempt_at:
            existing?.recording_first_attempt_at ?? new Date().toISOString(),
          recording_next_retry_at: new Date().toISOString(),
        })
        .eq("id", saved.id);

      if (call.recording.kind === "sarvam") {
        await retrySarvamRecording(saved.id, true);
      } else {
        const path = await storeRecording({
          // Which credential fetches this audio is a property of the AGENT,
          // not of the payload, so the adapter cannot know it — ElevenLabs
          // keys are workspace-scoped and our two clients are in different
          // workspaces. Attached here, where the agent row is already loaded.
          source:
            call.recording.kind === "elevenlabs"
              ? { ...call.recording, credentialRef: agent.credential_ref }
              : call.recording,
          tenantId: agent.tenant_id,
          provider: call.provider,
          providerCallId: call.providerCallId,
        });
        await supabase
          .from("calls")
          .update(
            path
              ? {
                  recording_path: path,
                  recording_status: "ready",
                  recording_next_retry_at: null,
                  recording_last_error: null,
                }
              : {
                  recording_status: "failed",
                  recording_attempts: 1,
                  recording_next_retry_at: null,
                  recording_last_error: "Provider recording download failed",
                }
          )
          .eq("id", saved.id);
      }
    } else if (existing.recording_status !== "ready") {
      await supabase
        .from("calls")
        .update({ recording_status: "ready", recording_next_retry_at: null })
        .eq("id", saved.id);
    }
  }

  // --- spec §4 step 3: qualifying calls create a lead ----------------------
  let leadCreated = false;
  if (qualifiesAsLead(outcome)) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", agent.tenant_id)
      .eq("stage", "new_inquiry");

    // Idempotent by call_id via the unique index, not a check-then-insert —
    // two deliveries landing together used to produce two cards for one caller.
    const { error: leadError, count: inserted } = await supabase
      .from("leads")
      .upsert(
        {
          tenant_id: agent.tenant_id,
          call_id: saved.id,
          name: call.callerName ?? call.callerPhone ?? "Unknown Caller",
          summary: buildLeadSummary(call.analysis, vertical),
          stage: "new_inquiry",
          tags: ["Inbound call"],
          position: count ?? 0,
        },
        { onConflict: "call_id", ignoreDuplicates: true, count: "exact" }
      );

    if (leadError) console.error("[ingest] lead upsert failed", leadError);
    else leadCreated = (inserted ?? 0) > 0;
  }

  // --- spec §4 step 4: count the minutes -----------------------------------
  // Claim the call before billing it. The row upserts idempotently but
  // add_call_minutes() does not, so a retried delivery billed twice. This
  // conditional update is atomic — exactly one caller wins it.
  if (call.isFinal && call.durationSeconds && call.durationSeconds > 0) {
    const { data: claimed } = await supabase
      .from("calls")
      .update({ minutes_counted_at: new Date().toISOString() })
      .eq("id", saved.id)
      .is("minutes_counted_at", null)
      .select("id");

    if (claimed && claimed.length > 0) {
      const { error: usageError } = await supabase.rpc("add_call_minutes", {
        p_tenant_id: agent.tenant_id,
        p_minutes: call.durationSeconds / 60,
      });
      if (usageError) console.error("[ingest] usage update failed", usageError);
    }
  }

  return { ok: true, callId: saved.id, leadCreated };
}

/**
 * Shared outcome inference, used when a provider's agent did not emit a usable
 * `outcome` variable of its own.
 *
 * An unrecognised value must never become a NULL outcome: those rows appear in
 * no filter chip and vanish from the Overview's breakdown.
 *
 * KNOWN GAP: no bucket for "reached a real person, they are busy, call back
 * later" — that lands in not_a_fit alongside wrong numbers. Raised with Khush;
 * a fifth enum value would go here and in both agent prompts together.
 */
/**
 * Every outcome an adapter may hand us.
 *
 * The FULL enum, not one vertical's subset, because adapters run before the
 * tenant is resolved and therefore cannot know which vertical the agent
 * serves. `ingestCall` narrows it once it does — see the downgrade there.
 * Validating against the wrong subset here is what would turn a booked site
 * visit into `not_a_fit` and score it cold, permanently.
 */
export const VALID_OUTCOMES: CallOutcome[] = [
  "inquiry_captured",
  "quote_requested",
  "voicemail",
  "not_a_fit",
  "site_visit_booked",
  "transferred_to_human",
];

/** Did the caller give us anything worth keeping, in either vertical? */
function capturedSomething(analysis: CallAnalysis): boolean {
  const keys = new Set<keyof CallAnalysis>([
    ...BRIEF_FIELDS.travel.map(([k]) => k),
    ...BRIEF_FIELDS.real_estate.map(([k]) => k),
  ]);
  for (const key of keys) {
    const value = analysis[key];
    if (typeof value === "string" && value.trim() !== "") return true;
  }
  return false;
}

export function inferOutcome(
  raw: unknown,
  analysis: CallAnalysis,
  durationSeconds: number
): CallOutcome {
  if (typeof raw === "string" && VALID_OUTCOMES.includes(raw as CallOutcome)) {
    return raw as CallOutcome;
  }
  // Short and nothing captured: almost certainly an answering machine.
  if (durationSeconds < 30 && !capturedSomething(analysis)) {
    return "voicemail";
  }
  // Same bar both agent prompts use: one concrete requirement is enough to be
  // worth a consultant's time. Vertical-agnostic, because this runs before the
  // vertical is known — a destination and a property type are the same signal
  // wearing different clothes.
  if (capturedSomething(analysis)) return "inquiry_captured";
  return "not_a_fit";
}

/**
 * Pull the brief fields out of whatever variable bag a provider sends.
 *
 * Reads the UNION of both verticals — a travel agent never emits
 * `property_type`, so that key comes back null, and no vertical argument is
 * needed at a point in the flow where the vertical is not yet known. Which of
 * these keys are SCORED is BRIEF_FIELDS in lib/calls.ts.
 *
 * These key names are exactly the columns of `calls.analysis` and exactly the
 * output variables configured on the agents. Keeping those three lists is what removes the need for a mapping layer —
 * and we already shipped that bug once, on the ElevenLabs agent, where the
 * prompt emitted `num_travellers` while the reader looked for `num_travelers`
 * and the field silently arrived empty forever.
 */
export function extractAnalysis(
  vars: Record<string, unknown> | null | undefined,
  fallbackNotes?: string | null
): CallAnalysis {
  const v = vars ?? {};
  const pick = (key: string): string | null => {
    const value = v[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    return null;
  };
  return {
    destination: pick("destination"),
    dates: pick("dates"),
    party_size: pick("party_size"),
    occasion: pick("occasion"),
    intent: pick("intent"),
    property_type: pick("property_type"),
    unit_size: pick("unit_size"),
    timeline: pick("timeline"),
    residency: pick("residency"),
    budget: pick("budget"),
    notes: pick("notes") ?? fallbackNotes ?? null,
  };
}
