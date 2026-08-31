import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { CallList } from "@/components/call/call-list";
import { CALL_FILTERS } from "@/lib/outcomes";
import { getOutcomeCounts } from "@/lib/metrics";

const PAGE_SIZE = 25;

export default async function CallsPage(
  props: PageProps<"/app/[tenant]/calls">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);
  const { filter, page } = await props.searchParams;
  const activeFilter =
    CALL_FILTERS.find((f) => f.key === filter)?.key ?? "all";

  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("calls")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .order("started_at", { ascending: false })
    .range(from, to);

  if (activeFilter !== "all") {
    query = query.eq("outcome", activeFilter);
  }

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

  return (
    <section className="panel on">
      <div className="card card-pad">
        <div className="card-head">
          <h3>Call log</h3>
          <div className="filters">
            {CALL_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`?filter=${f.key}`}
                className={`f-chip${activeFilter === f.key ? " on" : ""}`}
              >
                {f.label}
                <span className="c">{countFor(f.key)}</span>
              </Link>
            ))}
          </div>
        </div>
        <CallList calls={calls ?? []} tenantSlug={tenant.slug} />

        {totalPages > 1 && (
          <div className="pagination">
            {currentPage > 1 && (
              <Link href={`?filter=${activeFilter}&page=${currentPage - 1}`}>
                Previous
              </Link>
            )}
            <span>
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link href={`?filter=${activeFilter}&page=${currentPage + 1}`}>
                Next
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
