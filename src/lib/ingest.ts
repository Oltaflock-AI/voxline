import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { TranscriptTurn, CallAnalysis } from "@/lib/calls";
import { storeRecording, type RecordingSource } from "@/lib/recordings";

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

/** Spec §4 step 3: these two outcomes create a lead. */
export function qualifiesAsLead(outcome: CallOutcome) {
  return outcome === "inquiry_captured" || outcome === "quote_requested";
}

/** The one-line summary shown on a pipeline card. */
export function buildLeadSummary(analysis: CallAnalysis | undefined): string {
  if (!analysis) return "Trip inquiry";
  return (
    [analysis.destination, analysis.dates, analysis.party_size, analysis.budget]
      .filter(Boolean)
      .join(" · ") || "Trip inquiry"
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
    .select("id, tenant_id")
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
        outcome: call.outcome,
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
      .select("recording_path")
      .eq("id", saved.id)
      .single();

    if (!existing?.recording_path) {
      const path = await storeRecording({
        source: call.recording,
        tenantId: agent.tenant_id,
        provider: call.provider,
        providerCallId: call.providerCallId,
      });
      if (path) {
        await supabase
          .from("calls")
          .update({ recording_path: path })
          .eq("id", saved.id);
      }
    }
  }

  // --- spec §4 step 3: qualifying calls create a lead ----------------------
  let leadCreated = false;
  if (qualifiesAsLead(call.outcome)) {
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
          summary: buildLeadSummary(call.analysis),
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
export const VALID_OUTCOMES: CallOutcome[] = [
  "inquiry_captured",
  "quote_requested",
  "voicemail",
  "not_a_fit",
];

export function inferOutcome(
  raw: unknown,
  analysis: CallAnalysis,
  durationSeconds: number
): CallOutcome {
  if (typeof raw === "string" && VALID_OUTCOMES.includes(raw as CallOutcome)) {
    return raw as CallOutcome;
  }
  // Short and nothing captured: almost certainly an answering machine.
  if (durationSeconds < 30 && !analysis.destination && !analysis.dates) {
    return "voicemail";
  }
  // Same bar the agent prompt uses: a destination or a date is enough to be
  // worth a consultant's time.
  if (analysis.destination || analysis.dates) return "inquiry_captured";
  return "not_a_fit";
}

/**
 * Pull the six trip-brief fields out of whatever variable bag a provider sends.
 *
 * These six keys are exactly the columns of `calls.analysis` and exactly the
 * output variables configured on both the Sarvam and Retell agents. Keeping
 * those three lists identical is what removes the need for a mapping layer —
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
    budget: pick("budget"),
    occasion: pick("occasion"),
    notes: pick("notes") ?? fallbackNotes ?? null,
  };
}
