import type { Database } from "@/lib/supabase/database.types";

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
};

export const OUTCOME_ORDER: CallOutcome[] = [
  "inquiry_captured",
  "quote_requested",
  "voicemail",
  "not_a_fit",
];

/** Filter chips on the Calls tab (spec §6.3), in display order. */
export const CALL_FILTERS: { key: CallOutcome | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "inquiry_captured", label: "Inquiries" },
  { key: "quote_requested", label: "Quotes" },
  { key: "voicemail", label: "Voicemail" },
  { key: "not_a_fit", label: "Not a fit" },
];
