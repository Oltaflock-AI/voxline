import type { Database } from "@/lib/supabase/database.types";
import type { AgentVertical } from "@/lib/calls";

/**
 * Outcome constants, deliberately in their own module with NO imports that
 * touch the server.
 *
 * These are needed by both sides: `metrics.ts` (server, talks to Postgres) and
 * `call-list.tsx` (client, "use client"). They used to live in metrics.ts, and
 * that broke the build the moment a Client Component imported them — importing
 * one value from a module pulls in the whole module, so `next/headers` and the
 * Supabase server client got dragged into the browser bundle:
 *
 *   You're importing a component that needs "server-only"
 *     ./src/lib/supabase/server.ts [Client Component Browser]
 *     ./src/lib/metrics.ts         [Client Component Browser]
 *     ./src/components/call/call-list.tsx
 *
 * The lesson (concept #1): the server/client split is per *module*, not per
 * export. Shared constants belong in a leaf module that imports nothing but
 * types.
 */

export type CallOutcome = Database["public"]["Enums"]["call_outcome"];

/**
 * `cssKey` maps our spec §5 enum onto the class names the ported prototype
 * stylesheet already uses to tint the mini waveform (`.call.qualified .wave`
 * and friends). Renaming the CSS would mean editing the design source of
 * truth, which the spec forbids — so the mapping lives here.
 */
export const OUTCOME_META: Record<
  CallOutcome,
  { label: string; short: string; color: string; badge: string; cssKey: string }
> = {
  inquiry_captured: {
    label: "Trip inquiry captured",
    short: "Inquiry captured",
    color: "var(--positive)",
    badge: "ok",
    cssKey: "qualified",
  },
  quote_requested: {
    label: "Quote requested",
    short: "Quote requested",
    color: "var(--accent)",
    badge: "acc",
    cssKey: "booked",
  },
  voicemail: {
    label: "Voicemail / no answer",
    short: "Voicemail",
    color: "var(--muted)",
    badge: "",
    cssKey: "voicemail",
  },
  not_a_fit: {
    label: "Not a fit",
    short: "Not a fit",
    color: "var(--negative)",
    badge: "bad",
    cssKey: "lost",
  },
  // --- real estate ---------------------------------------------------------
  // cssKey reuses the existing prototype classes rather than adding new ones:
  // globals.css defines only `qualified`, `booked` and `lost`, and it is the
  // design source of truth, which AGENTS.md says wins on look.
  site_visit_booked: {
    label: "Site visit booked",
    short: "Visit booked",
    color: "var(--positive)",
    badge: "ok",
    cssKey: "booked",
  },
  transferred_to_human: {
    label: "Transferred to the team",
    short: "Transferred",
    color: "var(--accent)",
    badge: "acc",
    cssKey: "qualified",
  },
};

/**
 * Which outcomes a given vertical can actually produce, in display order.
 *
 * Keyed by vertical because the enum is shared but the outcomes are not: a
 * travel agency never books a site visit, and a real-estate agent is forbidden
 * from quoting a price. Showing a chip that is permanently 0 teaches an agency
 * to distrust the numbers on the page.
 *
 * These lists must stay in step with the CASE arms in
 * 20260906090100_real_estate_vertical.sql — an outcome scored there and missing
 * here is a call that scores but never appears in a filter.
 */
export const OUTCOMES_BY_VERTICAL: Record<AgentVertical, CallOutcome[]> = {
  travel: ["inquiry_captured", "quote_requested", "voicemail", "not_a_fit"],
  real_estate: [
    "site_visit_booked",
    "transferred_to_human",
    "inquiry_captured",
    "voicemail",
    "not_a_fit",
  ],
};

/**
 * Every outcome, for surfaces that are not scoped to one vertical — the
 * Overview breakdown on a tenant running both, and the admin console.
 */
export const OUTCOME_ORDER: CallOutcome[] = [
  "site_visit_booked",
  "quote_requested",
  "transferred_to_human",
  "inquiry_captured",
  "voicemail",
  "not_a_fit",
];

/** Filter chips on the Calls tab (spec §6.3), in display order. */
export type CallFilter = { key: CallOutcome | "all"; label: string };

const FILTER_LABELS: Record<CallOutcome, string> = {
  inquiry_captured: "Inquiries",
  quote_requested: "Quotes",
  site_visit_booked: "Visits booked",
  transferred_to_human: "Transferred",
  voicemail: "Voicemail",
  not_a_fit: "Not a fit",
};

/**
 * The chips for a tenant, given the verticals its agents actually run.
 *
 * A tenant with both gets the union, deduplicated and in OUTCOME_ORDER, rather
 * than two "Voicemail" chips.
 */
export function callFilters(verticals: AgentVertical[]): CallFilter[] {
  const wanted = new Set(
    (verticals.length ? verticals : (["travel"] as AgentVertical[])).flatMap(
      (v) => OUTCOMES_BY_VERTICAL[v]
    )
  );
  return [
    { key: "all" as const, label: "All" },
    ...OUTCOME_ORDER.filter((o) => wanted.has(o)).map((o) => ({
      key: o,
      label: FILTER_LABELS[o],
    })),
  ];
}
