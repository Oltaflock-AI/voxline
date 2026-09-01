import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { getOverviewMetrics } from "@/lib/metrics";
import { KpiCard } from "@/components/kpi-card";
import { BarChart, OutcomeBars } from "@/components/charts";
import { CallList } from "@/components/call/call-list";

/**
 * Overview — spec §6.2.
 *
 * A Server Component: it awaits the database directly, and what reaches the
 * browser is finished HTML plus the small islands that need interactivity
 * (CountUp, CallList). Trace any number on this page and it ends at a row in
 * `calls` — that is concept #2.
 */
export default async function OverviewPage(props: PageProps<"/app/[tenant]">) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);

  const supabase = await createClient();

  const [metrics, { data: recent }] = await Promise.all([
    getOverviewMetrics(tenant.id),
    supabase
      .from("calls")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("started_at", { ascending: false })
      .limit(4), // spec §6.2: "the four newest rows"
  ]);

  // No fallback day here. With no calls at all there is no peak to name, and
  // inventing a placeholder day reads as data. The subtitle drops the clause.
  const peak = metrics.volume.length
    ? metrics.volume.reduce((best, d) => (d.v > best.v ? d : best))
    : null;
  const volumeTotal = metrics.volume.reduce((a, d) => a + d.v, 0);
  const outcomeTotal = metrics.outcomes.reduce((a, o) => a + o.n, 0);

  return (
    <section className="panel on">
      <div className="kpi-row">
        {metrics.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="card-head">
            <h3>Call volume</h3>
            <span className="card-sub">
              {volumeTotal} calls{peak ? ` · peak ${peak.d}` : ""}
            </span>
          </div>
          <BarChart data={metrics.volume} />
        </div>

        <div className="card card-pad">
          <div className="card-head">
            <h3>Outcomes</h3>
            <span className="card-sub">{outcomeTotal} calls</span>
          </div>
          <OutcomeBars outcomes={metrics.outcomes} />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>Recent calls</h3>
          <Link className="btn-quiet" href={`/app/${tenant.slug}/calls`}>
            View all
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
        <CallList
          calls={recent ?? []}
          tenantSlug={tenant.slug}
          emptyTitle="No calls yet"
          emptyBody="When your agent answers its first call, it will appear here within a minute."
        />
      </div>
    </section>
  );
}
