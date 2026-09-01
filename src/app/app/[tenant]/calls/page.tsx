import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { CallList } from "@/components/call/call-list";
import { CallSearch } from "@/components/call/call-search";
import { CALL_FILTERS } from "@/lib/outcomes";
import { getOutcomeCounts } from "@/lib/metrics";
import {
  BAND_META,
  BAND_ORDER,
  BAND_RANGE_LABEL,
  bandRange,
  type LeadBand,
} from "@/lib/score";

const PAGE_SIZE = 25;

/**
 * Escape a user's search text for PostgREST's `or=` filter.
 *
 * The value is interpolated into a filter EXPRESSION, not bound as a
 * parameter, so a comma or a parenthesis would end the current condition and
 * start another one the user chose. `%` and `_` are the LIKE wildcards and are
 * escaped so a search for "50%" means the characters, not "5, anything".
 */
function escapeForFilter(raw: string) {
  return raw.replace(/[%_]/g, (c) => `\\${c}`).replace(/[(),*"\\]/g, " ").trim();
}

export default async function CallsPage(
  props: PageProps<"/app/[tenant]/calls">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);
  const { filter, page, q, band } = await props.searchParams;

  const activeFilter =
    CALL_FILTERS.find((f) => f.key === filter)?.key ?? "all";
  const activeBand = BAND_ORDER.includes(band as LeadBand)
    ? (band as LeadBand)
    : null;
  const search = typeof q === "string" ? q.slice(0, 100) : "";

  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("calls")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .range(from, to);

  if (activeFilter !== "all") query = query.eq("outcome", activeFilter);

  if (activeBand) {
    const { min, max } = bandRange(activeBand);
    query = query.gte("lead_score", min).lte("lead_score", max);
  }

  const cleaned = escapeForFilter(search);
  if (cleaned) {
    query = query.or(
      `caller_name.ilike.%${cleaned}%,caller_phone.ilike.%${cleaned}%`
    );
  }

  // Sorting follows intent. Filtering by band means "who should I ring first",
  // so the best lead goes on top; otherwise a call log reads newest-first.
  query = activeBand
    ? query.order("lead_score", { ascending: false }).order("started_at", { ascending: false })
    : query.order("started_at", { ascending: false });

  const { data: calls, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // Chip totals are for the whole call log, not the current page — otherwise
  // "Voicemail 39" would read "Voicemail 3" while you are on page two.
  //
  // Counted in Postgres, not here. Selecting every row to tally them in JS
  // capped silently at PostgREST's 1000-row limit, so on a tenant with 1,369
  // calls the chips summed to 1000 while the sidebar said 1369 — two numbers
  // for the same thing on one screen.
  const outcomeCounts = await getOutcomeCounts(tenant.id);
  const countFor = (key: string) => outcomeCounts[key] ?? 0;

  /** Preserve the other filters when one of them changes. */
  const linkWith = (next: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null> = {
      filter: activeFilter === "all" ? null : activeFilter,
      band: activeBand,
      q: search || null,
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const filtered = Boolean(activeBand || cleaned || activeFilter !== "all");

  return (
    <section className="panel on">
      <div className="card card-pad">
        <div className="card-head calls-head">
          <h3>Call log</h3>
          <CallSearch initial={search} />
        </div>

        <div className="calls-filters">
          <div className="filters">
            {CALL_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={linkWith({ filter: f.key === "all" ? null : f.key, page: null })}
                className={`f-chip${activeFilter === f.key ? " on" : ""}`}
              >
                {f.label}
                <span className="c">{countFor(f.key)}</span>
              </Link>
            ))}
          </div>

          {/* Score bands are a separate axis from outcome: "hot" and "quote
              requested" answer different questions and combine usefully. */}
          <div className="filters band-filters">
            {BAND_ORDER.map((b) => (
              <Link
                key={b}
                href={linkWith({ band: activeBand === b ? null : b, page: null })}
                className={`f-chip band-${b}${activeBand === b ? " on" : ""}`}
                title={BAND_META[b].blurb}
              >
                <span className="dot" />
                {BAND_META[b].label}
              </Link>
            ))}
          </div>
        </div>

        {/*
          What the bands mean, stated once where they are used.
          A score is only useful if the reader knows what earns it; without
          this, "Hot 85" is a number the agency has to take on trust. Kept to
          one line per band so it costs almost no vertical space.
        */}
        <dl className="score-key">
          {BAND_ORDER.map((b) => (
            <div key={b}>
              <dt className={`score-badge ${b} sm`}>
                <span className="dot" />
                {BAND_META[b].label}
              </dt>
              <dd>
                <span className="score-key-range">{BAND_RANGE_LABEL[b]}</span>
                {BAND_META[b].blurb}
              </dd>
            </div>
          ))}
        </dl>

        {filtered && (
          <p className="result-count">
            {count ?? 0} {count === 1 ? "call matches" : "calls match"}
            {cleaned ? ` “${search}”` : " these filters"}
            {" · "}
            <Link href="?">Clear</Link>
          </p>
        )}

        <CallList
          calls={calls ?? []}
          tenantSlug={tenant.slug}
          emptyTitle={filtered ? "No calls match" : undefined}
          emptyBody={
            filtered
              ? "Try a different search, or clear the filters to see everything."
              : undefined
          }
        />

        {totalPages > 1 && (
          <div className="pagination">
            {currentPage > 1 && (
              <Link href={linkWith({ page: String(currentPage - 1) })}>
                Previous
              </Link>
            )}
            <span>
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link href={linkWith({ page: String(currentPage + 1) })}>
                Next
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
