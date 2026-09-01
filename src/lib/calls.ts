import type { Database } from "@/lib/supabase/database.types";

export type CallRowData =
  Database["public"]["Tables"]["calls"]["Row"];

/** One turn of the conversation. Stored shape: calls.transcript jsonb. */
export type TranscriptTurn = { speaker: string; text: string; ts: number };

/** Structured post-call analysis. Stored shape: calls.analysis jsonb. */
export type CallAnalysis = {
  destination?: string | null;
  dates?: string | null;
  party_size?: string | null;
  budget?: string | null;
  occasion?: string | null;
  notes?: string | null;
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
    budget: str(a.budget),
    occasion: str(a.occasion),
    notes: str(a.notes),
  };
}

/** True when there is enough in the analysis to be worth showing a brief. */
export function hasBrief(a: CallAnalysis) {
  return Boolean(
    a.destination || a.dates || a.party_size || a.budget || a.occasion
  );
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
