import { createClient } from "@/lib/supabase/server";
import type { CallOutcome } from "@/lib/outcomes";

import { OUTCOME_META, OUTCOME_ORDER } from "@/lib/outcomes";
export type { CallOutcome } from "@/lib/outcomes";
export { OUTCOME_META, OUTCOME_ORDER } from "@/lib/outcomes";

export type Kpi = {
  label: string;
  value: string;
  frac?: string;
  delta: string;
  dir: "up" | "down" | "flat";
  /**
   * Why this card shows no verdict. Only read when `dir` is "flat", where it
   * becomes the tooltip on the grey marker. Green and red are `--positive` and
   * `--negative`, so they claim a figure moved in a good or a bad direction;
   * some figures cannot support that claim, and this says which and why.
   */
  neutralWhy?: string;
  note: string;
  spark: number[];
  /**
   * ONE supporting figure, as a number and a quiet label.
   *
   * Deliberately capped at one. Two lines of support per card turned the row
   * into something to read rather than something to scan, and the second line
   * was usually either restating the headline ("+0:05 longer per call" under a
   * "+3%" delta) or repeating a neighbouring card ("46 of 96 calls became
   * leads" under a card already showing 46 leads).
   *
   * The bar for what goes here: it must be a fact the agency cannot already
   * see on this card or the one beside it, and one they would act on.
   */
  breakdown?: { value: string; label: string };
};

export type OverviewMetrics = {
  kpis: Kpi[];
  volume: { d: string; v: number }[];
  outcomes: { outcome: CallOutcome; label: string; n: number; color: string }[];
  totalCalls: number;
};

const DAY_MS = 86_400_000;

/**
 * Start of the UTC day.
 *
 * setHours() would use whatever timezone the server happens to be in — IST on
 * a laptop in Ahmedabad, UTC on Vercel. That made "Calls handled" read 100 in
 * dev and 96 in production off identical data, because the seven-day window
 * started at a different instant. A metric that changes depending on where the
 * process runs is not a metric.
 *
 * UTC is the fix here but not the final answer: a Miami agency's "today" is
 * not UTC's, so an evening call lands on tomorrow's bar. The real fix is a
 * per-tenant timezone, which the schema does not have yet.
 * OPEN QUESTION FOR KHUSH — see VOXLINE_BUILD_PLAN.md.
 */
function startOfDay(d: Date) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/** YYYY-MM-DD in UTC, matching the `bucket` date the RPC returns. */
function utcDayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fmtDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pctDelta(now: number, prev: number) {
  if (prev === 0) return now === 0 ? "0%" : "new";
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

type StatRow = {
  bucket: string;
  outcome: CallOutcome | null;
  n: number;
  total_seconds: number;
};

/**
 * Overview metrics for a tenant. Spec §6.2: each figure is computed for the
 * selected range against the previous equal-length range.
 *
 * WHERE THE AGGREGATION HAPPENS (concept #6).
 *
 * This used to pull every raw call row for the last 14 days and count them in
 * JavaScript. That was silently wrong above 1000 calls, because PostgREST caps
 * responses at `max_rows` with no error — and since rows came back
 * oldest-first, the days that vanished were the most recent ones. The volume
 * chart showed 0 calls for today on a tenant with 1,369 of them.
 *
 * Now Postgres does the grouping (see 20260829120000_stats_rpc.sql) and hands
 * back at most 14 days × 4 outcomes = 56 rows. Correct at any volume, and far
 * less data over the wire.
 */
export async function getOverviewMetrics(
  tenantId: string,
  days = 7
): Promise<OverviewMetrics> {
  const supabase = await createClient();

  const today = startOfDay(new Date());
  const rangeStart = new Date(today.getTime() - (days - 1) * DAY_MS);
  const rangeEnd = new Date(today.getTime() + DAY_MS); // exclusive
  const prevStart = new Date(rangeStart.getTime() - days * DAY_MS);

  const [{ data: current, error: curErr }, { data: previous, error: prevErr }] =
    await Promise.all([
      supabase.rpc("call_stats_daily", {
        p_tenant_id: tenantId,
        p_from: rangeStart.toISOString(),
        p_to: rangeEnd.toISOString(),
      }),
      supabase.rpc("call_stats_daily", {
        p_tenant_id: tenantId,
        p_from: prevStart.toISOString(),
        p_to: rangeStart.toISOString(),
      }),
    ]);

  if (curErr) throw curErr;
  if (prevErr) throw prevErr;

  const rows = (current ?? []) as StatRow[];
  const prevRows = (previous ?? []) as StatRow[];

  const sum = (list: StatRow[], pick: (r: StatRow) => number) =>
    list.reduce((a, r) => a + pick(r), 0);

  // --- daily buckets, for the volume bars and the sparklines ---
  const dayLabels: string[] = [];
  const dayCounts: number[] = [];
  const dayMinutes: number[] = [];
  const dayInquiries: number[] = [];
  const dayAvgMinutes: number[] = [];

  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * DAY_MS);
    const key = utcDayKey(day);
    const dayRows = rows.filter((r) => r.bucket === key);
    // Voicemails are excluded from handle time: a 40-second "leave a message"
    // beep drags the average down and is not a handled call in any useful sense.
    const handledRows = dayRows.filter((r) => r.outcome !== "voicemail");
    const handledN = sum(handledRows, (r) => r.n);

    dayLabels.push(
      day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    );
    dayCounts.push(sum(dayRows, (r) => r.n));
    dayMinutes.push(sum(dayRows, (r) => r.total_seconds) / 60);
    dayInquiries.push(
      sum(
        dayRows.filter((r) => r.outcome === "inquiry_captured"),
        (r) => r.n
      )
    );
    dayAvgMinutes.push(
      handledN ? sum(handledRows, (r) => r.total_seconds) / handledN / 60 : 0
    );
  }

  // --- outcomes ---
  const outcomeCounts = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    label: OUTCOME_META[outcome].label,
    color: OUTCOME_META[outcome].color,
    n: sum(
      rows.filter((r) => r.outcome === outcome),
      (r) => r.n
    ),
  }));

  // --- KPI 1: calls handled ---
  const calls = sum(rows, (r) => r.n);
  const prevCalls = sum(prevRows, (r) => r.n);

  // --- KPI 2: trip inquiries ---
  const inquiries = sum(
    rows.filter((r) => r.outcome === "inquiry_captured"),
    (r) => r.n
  );
  const prevInquiries = sum(
    prevRows.filter((r) => r.outcome === "inquiry_captured"),
    (r) => r.n
  );

  // --- KPI 3: average handle time ---
  const handled = rows.filter((r) => r.outcome !== "voicemail");
  const prevHandled = prevRows.filter((r) => r.outcome !== "voicemail");
  const handledN = sum(handled, (r) => r.n);
  const prevHandledN = sum(prevHandled, (r) => r.n);
  const avg = handledN ? sum(handled, (r) => r.total_seconds) / handledN : 0;
  const prevAvg = prevHandledN
    ? sum(prevHandled, (r) => r.total_seconds) / prevHandledN
    : 0;

  // --- breakdown figures for the KPI sub-lines ---
  // The voicemail count and the absolute change in handle time both used to
  // live here, as second breakdown lines. They are gone because each card now
  // carries one figure: the voicemail total is already on the Outcomes panel
  // below, and the absolute change was the headline percentage restated in
  // other units.
  const quotes = sum(
    rows.filter((r) => r.outcome === "quote_requested"),
    (r) => r.n
  );
  // Deliberately NOT reporting an "answered" count. It would have to be
  // `calls - voicemails`, and `not_a_fit` carries two different things: a real
  // person who was not a fit, AND a call that never connected at all (see the
  // outcome mapping in lib/providers/sarvam.ts). Counting both as answered
  // would overstate how many callers the agent actually reached, and the
  // schema has no way to separate them.
  const leads = inquiries + quotes;
  // Both outcomes that create a lead, over everything that rang. This is the
  // number a travel agency would actually put in front of its owner.
  const totalTalkSeconds = sum(rows, (r) => r.total_seconds);


  // --- KPI 4: minutes used against the plan quota ---
  const { data: usage } = await supabase
    .from("usage_periods")
    .select("minutes_used, period_end")
    .eq("tenant_id", tenantId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: tenantPlan } = await supabase
    .from("tenants")
    .select("plans ( included_minutes )")
    .eq("id", tenantId)
    .maybeSingle();

  const included = tenantPlan?.plans?.included_minutes ?? null;
  const minutesUsed = Math.round(Number(usage?.minutes_used ?? 0));

  // Cumulative, because a usage bar that goes down mid-period is a lie.
  let running = 0;
  const minutesSpark = dayMinutes.map((m) => (running += m));

  const kpis: Kpi[] = [
    {
      label: "Calls handled",
      value: calls.toLocaleString(),
      delta: pctDelta(calls, prevCalls),
      dir: calls >= prevCalls ? "up" : "down",
      note: `vs previous ${days} days`,
      spark: dayCounts,
      breakdown: { value: leads.toLocaleString(), label: "became leads" },
    },
    {
      label: "Trip inquiries",
      value: inquiries.toLocaleString(),
      delta: pctDelta(inquiries, prevInquiries),
      dir: inquiries >= prevInquiries ? "up" : "down",
      note: `vs previous ${days} days`,
      spark: dayInquiries,
      breakdown: {
        value: quotes.toLocaleString(),
        label: "more asked for a quote",
      },
    },
    {
      label: "Avg handle time",
      value: fmtDuration(avg),
      // A percentage, like the two cards to its left, so the four second rows
      // can be read against each other at a glance. This used to be "+0:05",
      // a duration sitting in the same slot as two percentages, which made the
      // row impossible to compare across cards.
      delta: pctDelta(avg, prevAvg),
      // Stays grey on purpose, and is the answer to "why is this one not
      // green": green here is `--positive`, so it is a verdict, not an arrow.
      // A longer call often means the agent got further into qualifying the
      // caller, and a much longer one means it got stuck. Neither reading is
      // safe to assert from the number alone, so the card reports the movement
      // and declines the verdict. The flat mark and its tooltip say so.
      dir: "flat",
      neutralWhy:
        "Shown without a colour on purpose. A longer call can mean the agent " +
        "qualified the caller properly or that the caller went in circles, so " +
        "there is no good or bad direction to claim.",
      note: `vs previous ${days} days`,
      spark: dayAvgMinutes,
      // The seconds the headline percentage stands for, then the workload the
      // average is drawn from. Total talk time is the useful complement to an
      // average, and the daily stats RPC returns no per-call maximum to report
      // a spread from.
      breakdown: {
        value: `${Math.round(totalTalkSeconds / 60).toLocaleString()}m`,
        label: "of talk time handled",
      },
    },
    {
      label: "Minutes used",
      value: minutesUsed.toLocaleString(),
      frac: included ? `/ ${included.toLocaleString()}` : undefined,
      delta: included
        ? `${Math.round((minutesUsed / included) * 100)}% of plan`
        : "no plan",
      dir: "flat",
      neutralWhy:
        "This is how much of the plan has been used so far, not a change on " +
        "the previous week, so there is no up or down to show.",
      note: usage?.period_end
        ? `resets ${new Date(usage.period_end).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}`
        : "current period",
      spark: minutesSpark,
      breakdown: included
        ? {
            value: Math.max(0, included - minutesUsed).toLocaleString(),
            label: "minutes left this period",
          }
        : undefined,
    },
  ];

  return {
    kpis,
    volume: dayLabels.map((d, i) => ({ d, v: dayCounts[i] })),
    outcomes: outcomeCounts,
    totalCalls: calls,
  };
}

/**
 * All-time outcome totals for the Calls tab filter chips.
 *
 * Also an RPC, and for the same reason: the previous version selected every
 * call row for the tenant just to count them, so the chips silently capped at
 * 1000 and disagreed with the sidebar count on the same screen.
 */
export async function getOutcomeCounts(
  tenantId: string
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("call_outcome_counts", {
    p_tenant_id: tenantId,
  });
  if (error) throw error;

  const counts: Record<string, number> = { all: 0 };
  for (const row of (data ?? []) as { outcome: CallOutcome | null; n: number }[]) {
    if (row.outcome) counts[row.outcome] = Number(row.n);
    counts.all += Number(row.n);
  }
  return counts;
}
