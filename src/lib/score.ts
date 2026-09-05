import type { CallOutcome } from "@/lib/outcomes";
import { BRIEF_FIELDS, type AgentVertical, type CallAnalysis } from "@/lib/calls";

/**
 * Lead score bands and the explanation behind them.
 *
 * The number itself is computed in Postgres — `calls.lead_score` is a stored
 * generated column, see 20260901090000_lead_score.sql. This file owns what the
 * number MEANS: where the band boundaries sit, and how to say out loud why a
 * call scored what it did.
 *
 * A leaf module on purpose: no `next/headers`, no Supabase client, nothing
 * server-only. Both the server-rendered call list and client components import
 * it, and dragging a server import in here would pull `next/headers` into the
 * browser bundle. That is the exact mistake `lib/outcomes.ts` was split out of
 * `lib/metrics.ts` to fix.
 */

export type LeadBand = "hot" | "warm" | "cold";

export const BAND_META: Record<
  LeadBand,
  { label: string; badge: string; blurb: string }
> = {
  hot: {
    label: "Hot",
    badge: "ok",
    blurb: "Ready to quote. Call this one back first.",
  },
  warm: {
    label: "Warm",
    badge: "acc",
    blurb: "A real enquiry with gaps to fill in.",
  },
  cold: {
    label: "Cold",
    badge: "",
    blurb: "Little to work with: no brief, or nobody reached.",
  },
};

export const BAND_ORDER: LeadBand[] = ["hot", "warm", "cold"];

/** The score range each band covers, for the key shown on the Calls tab. */
export const BAND_RANGE_LABEL: Record<LeadBand, string> = {
  hot: "80+",
  warm: "60-79",
  cold: "under 60",
};

/** Boundaries must match the arithmetic in the migration. */
export function bandFor(score: number | null | undefined): LeadBand {
  if (score == null) return "cold";
  if (score >= 80) return "hot";
  if (score >= 60) return "warm";
  return "cold";
}

/** Inclusive score range for a band, for building database filters. */
export function bandRange(band: LeadBand): { min: number; max: number } {
  if (band === "hot") return { min: 80, max: 100 };
  if (band === "warm") return { min: 60, max: 79 };
  return { min: 0, max: 59 };
}

/**
 * What each outcome is worth, per vertical.
 *
 * Keyed by vertical because the generated column is: the travel branch of
 * 20260906090100_real_estate_vertical.sql has no arm for site_visit_booked, so
 * it falls to `else 0` there while being the top score in real estate. A flat
 * map cannot express that, and the panel would claim 45 points the database
 * never gave.
 *
 * MIRRORS THE MIGRATION. If those CASE arms change, these numbers change in
 * the same commit — the migration's header says so too.
 */
const OUTCOME_POINTS: Record<AgentVertical, Record<CallOutcome, number>> = {
  travel: {
    quote_requested: 45,
    inquiry_captured: 30,
    voicemail: 5,
    not_a_fit: 0,
    site_visit_booked: 0,
    transferred_to_human: 0,
  },
  real_estate: {
    site_visit_booked: 45,
    transferred_to_human: 35,
    quote_requested: 30,
    inquiry_captured: 30,
    voicemail: 5,
    not_a_fit: 0,
  },
};

/** How to describe what the caller did, per vertical. */
const OUTCOME_DETAIL: Record<AgentVertical, Record<CallOutcome, string>> = {
  travel: {
    quote_requested: "Asked for a quote",
    inquiry_captured: "Left a trip enquiry",
    voicemail: "Reached voicemail",
    not_a_fit: "Not a fit",
    site_visit_booked: "Booked a visit — not scored for travel",
    transferred_to_human: "Transferred — not scored for travel",
  },
  real_estate: {
    site_visit_booked: "Booked a site visit",
    transferred_to_human: "Asked for the team and was transferred",
    quote_requested: "Asked about price",
    inquiry_captured: "Left a property enquiry",
    voicemail: "Reached voicemail",
    not_a_fit: "Not a fit",
  },
};

export type ScorePart = {
  label: string;
  points: number;
  max: number;
  detail: string;
};

/**
 * Rebuild the three parts of a score so the portal can show its working.
 *
 * This is the point of difference from the dashboard the idea came from, which
 * shows a bare number. An agency told a lead is "72" and given no reason has
 * been handed a magic number, and people do not sort their callbacks by a
 * number they do not trust. Showing that it is 45 for a quote request, 16 for
 * two brief fields and 11 for four minutes on the line makes it checkable.
 *
 * Reads the same columns as the generated column and applies the same
 * arithmetic. If the migration's formula changes, this changes with it — the
 * migration comment says so too.
 */
export function explainScore(call: {
  outcome: CallOutcome | null;
  analysis: CallAnalysis | null | undefined;
  duration_seconds: number | null;
  vertical: AgentVertical;
}): { parts: ScorePart[]; total: number } {
  const vertical = call.vertical;
  const outcomePoints = call.outcome ? OUTCOME_POINTS[vertical][call.outcome] : 0;

  const captured = BRIEF_FIELDS[vertical].filter(([key]) => {
    const value = call.analysis?.[key];
    return typeof value === "string" && value.trim() !== "";
  });

  const duration = call.duration_seconds ?? 0;
  const engagement = Math.min(15, Math.floor(duration / 20));

  const parts: ScorePart[] = [
    {
      label: "What the caller did",
      points: outcomePoints,
      max: 45,
      detail: call.outcome
        ? OUTCOME_DETAIL[vertical][call.outcome]
        : "No outcome recorded",
    },
    {
      label: vertical === "real_estate" ? "Requirements captured" : "Trip details captured",
      points: captured.length * 8,
      max: 40,
      detail:
        captured.length === 0
          ? "Nothing captured"
          : captured.map(([, label]) => label).join(", "),
    },
    {
      label: "Time on the call",
      points: engagement,
      max: 15,
      detail:
        duration > 0
          ? `${Math.floor(duration / 60)}m ${duration % 60}s on the line`
          : "No talk time",
    },
  ];

  return {
    parts,
    total: Math.min(100, parts.reduce((sum, p) => sum + p.points, 0)),
  };
}
