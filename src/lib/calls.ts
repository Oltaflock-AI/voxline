import type { Database } from "@/lib/supabase/database.types";

export type CallRowData =
  Database["public"]["Tables"]["calls"]["Row"];

/** One turn of the conversation. Stored shape: calls.transcript jsonb. */
export type TranscriptTurn = { speaker: string; text: string; ts: number };

/** Which product an agent sells. Drives the brief, the outcomes and the score. */
export type AgentVertical = Database["public"]["Enums"]["agent_vertical"];

/**
 * Structured post-call analysis. Stored shape: calls.analysis jsonb.
 *
 * One type for both verticals rather than a union, because the column is one
 * column and a travel key on a real-estate call is absent, not invalid. Which
 * keys MEAN something for a given vertical is BRIEF_FIELDS below — that table,
 * not this type, is the thing that must not drift from the SQL.
 *
 * `budget` is shared: both verticals ask about money, and both score it.
 */
export type CallAnalysis = {
  // travel
  destination?: string | null;
  dates?: string | null;
  party_size?: string | null;
  occasion?: string | null;
  // real estate
  intent?: string | null;
  property_type?: string | null;
  unit_size?: string | null;
  timeline?: string | null;
  /**
   * Local vs NRI. Load-bearing for Indian real estate and worth capturing, but
   * deliberately absent from BRIEF_FIELDS: it describes who the buyer IS, not
   * how close they are to buying, and the migration does not score it. Adding
   * it to the table below would make explainScore disagree with lead_score.
   */
  residency?: string | null;
  // both
  budget?: string | null;
  notes?: string | null;
};

/**
 * Which analysis keys make up the brief, per vertical, in display order.
 *
 * THE SINGLE SOURCE OF TRUTH, and it has four consumers: the brief component,
 * the score explanation, the Calls-tab summary line and the pipeline card
 * summary. Every one of them used to hold its own copy of the travel list.
 *
 * These five keys per vertical are exactly the five the generated lead_score
 * column counts at 8 points each — see 20260906090100_real_estate_vertical.sql.
 * Change one and you must change the other in the same commit.
 */
export const BRIEF_FIELDS: Record<
  AgentVertical,
  [keyof CallAnalysis, string][]
> = {
  travel: [
    ["destination", "Destination"],
    ["dates", "Dates"],
    ["party_size", "Party size"],
    ["budget", "Budget"],
    ["occasion", "Occasion"],
  ],
  real_estate: [
    ["intent", "Intent"],
    ["property_type", "Property type"],
    ["unit_size", "Size"],
    ["timeline", "Timeline"],
    ["budget", "Budget"],
  ],
};

/** What the brief card is called. A travel agency has no "property brief". */
export const BRIEF_TITLE: Record<AgentVertical, string> = {
  travel: "Trip brief",
  real_estate: "Property brief",
};

/** What an empty pipeline card says when the brief captured nothing. */
export const LEAD_FALLBACK_SUMMARY: Record<AgentVertical, string> = {
  travel: "Trip inquiry",
  real_estate: "Property inquiry",
};

/**
 * jsonb comes back as `Json`, which is anything. These two narrow it at the
 * boundary so the rest of the app can rely on a shape.
 *
 * They are defensive on purpose: the webhook writes this column from whatever
 * Retell sends, so a malformed payload should render an empty transcript, not
 * crash the Calls tab.
 */
export function parseTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((t) => {
    if (typeof t !== "object" || t === null) return [];
    const turn = t as Record<string, unknown>;
    if (typeof turn.speaker !== "string" || typeof turn.text !== "string") {
      return [];
    }
    return [
      {
        speaker: turn.speaker,
        text: turn.text,
        ts: typeof turn.ts === "number" ? turn.ts : 0,
      },
    ];
  });
}

export function parseAnalysis(value: unknown): CallAnalysis {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const a = value as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    destination: str(a.destination),
    dates: str(a.dates),
    party_size: str(a.party_size),
    occasion: str(a.occasion),
    intent: str(a.intent),
    property_type: str(a.property_type),
    unit_size: str(a.unit_size),
    timeline: str(a.timeline),
    residency: str(a.residency),
    budget: str(a.budget),
    notes: str(a.notes),
  };
}

/**
 * True when there is enough in the analysis to be worth showing a brief.
 *
 * Vertical-aware, because the travel-only version rendered "No trip details
 * captured" over a fully populated property brief.
 */
export function hasBrief(a: CallAnalysis, vertical: AgentVertical) {
  return BRIEF_FIELDS[vertical].some(([key]) => {
    const value = a[key];
    return typeof value === "string" && value.trim() !== "";
  });
}

export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "Today · 4:32 PM", "Yesterday · 8:11 PM", "Mon · 3:40 PM" — as prototyped.
 *
 * UTC, to match lib/metrics.ts. If this rendered in the viewer's local time
 * while the Overview bucketed by UTC day, a call could sit under "Today" here
 * and in yesterday's bar on the chart — the same call, two different days, on
 * one screen.
 *
 * Same caveat as metrics: UTC is consistent, not correct. A Miami consultant
 * wants Miami time. That needs a per-tenant timezone column.
 * OPEN QUESTION FOR KHUSH — see VOXLINE_BUILD_PLAN.md.
 */
export function formatWhen(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const startOf = (x: Date) =>
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const dayDiff = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);

  if (dayDiff === 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Yesterday · ${time}`;
  if (dayDiff < 7)
    return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} · ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${time}`;
}

/** Full timestamp for the call-detail page, kept in the portal's UTC clock. */
export function formatCallDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
