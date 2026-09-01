import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { UsageBar } from "@/components/usage-bar";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Billing & usage — spec §6.5.
 *
 * SCOPE NOTE: Stripe (ticket S-3) is cut from this sprint — see
 * VOXLINE_BUILD_PLAN.md. Spec §6.5 lists Billing as "Phase 2, static plan data
 * in Phase 1", so this is the sanctioned Phase 1 version: plan and usage are
 * real (from `plans` and `usage_periods`), invoice history is real (from
 * `invoices`), and the two buttons that would hand off to Stripe say so
 * instead of pretending.
 *
 * What is missing when S-3 lands: the upcoming-invoice figure comes from
 * Stripe rather than being computed here, "Update payment method" opens the
 * Stripe customer portal, and the payment-failure banner appears.
 */
export default async function BillingPage(
  props: PageProps<"/app/[tenant]/billing">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);

  const supabase = await createClient();

  const [{ data: tenantRow }, { data: usage }, { data: invoices }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("plans ( name, monthly_price_cents, included_minutes, overage_cents_per_min )")
        .eq("id", tenant.id)
        .maybeSingle(),
      supabase
        .from("usage_periods")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false }),
    ]);

  const plan = tenantRow?.plans ?? null;
  const used = Math.round(Number(usage?.minutes_used ?? 0));
  const included = plan?.included_minutes ?? 0;
  const overageMinutes = Math.max(0, used - included);
  const overageCents = overageMinutes * (plan?.overage_cents_per_min ?? 0);
  const baseCents = plan?.monthly_price_cents ?? 0;

  return (
    <section className="panel on">
      <div className="grid-2">
        <div className="card card-pad">
          <div className="card-head">
            <h3>Current plan</h3>
            {plan && (
              <span className="badge acc">
                {plan.name[0].toUpperCase() + plan.name.slice(1)}
              </span>
            )}
          </div>

          {plan ? (
            <>
              <div className="card-sub">
                {plan.included_minutes.toLocaleString()} minutes included · $
                {(plan.overage_cents_per_min / 100).toFixed(2)} per extra
                minute
              </div>
              <UsageBar used={used} included={plan.included_minutes} />
            </>
          ) : (
            <div className="card-sub">
              No plan is attached to this agency yet.
            </div>
          )}

          <div
            style={{ display: "flex", gap: 9, marginTop: 22, flexWrap: "wrap" }}
          >
            <button className="btn-ghost sm" disabled title="Arrives with Stripe billing">
              Update payment method
            </button>
            <button className="btn-ghost sm" disabled title="Plan changes go through your account manager">
              Change plan
            </button>
          </div>
        </div>

        <div className="card card-pad">
          <span className="lab">Next invoice</span>
          <div className="kpi-val" style={{ marginTop: 12 }}>
            <b className="num">{money(baseCents + overageCents)}</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
            {usage?.period_end
              ? `Bills automatically on ${new Date(
                  usage.period_end
                ).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}`
              : "No billing period open"}
          </div>

          <hr className="rule" style={{ margin: "20px 0" }} />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--text-2)",
              marginBottom: 9,
            }}
          >
            <span>Base plan</span>
            <span className="mono">{money(baseCents)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            <span>
              Overage this period
              {overageMinutes > 0 && ` (${overageMinutes.toLocaleString()} min)`}
            </span>
            <span className="mono">{money(overageCents)}</span>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>Invoice history</h3>
          <span className="card-sub">
            Paid automatically from your payment method on file
          </span>
        </div>

        {invoices && invoices.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Period</th>
                <th>Minutes</th>
                <th>Status</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{inv.number ?? "Not set"}</td>
                  <td>{inv.period_label ?? "Not set"}</td>
                  <td className="num">
                    {Number(inv.minutes).toLocaleString()}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        inv.status === "paid"
                          ? "ok"
                          : inv.status === "void"
                            ? "bad"
                            : "warn"
                      }`}
                    >
                      {inv.status[0].toUpperCase() + inv.status.slice(1)}
                    </span>
                  </td>
                  <td className="r num">{money(inv.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <b>No invoices yet</b>
            <p>Your first invoice appears here at the end of the period.</p>
          </div>
        )}
      </div>
    </section>
  );
}
