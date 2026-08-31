/**
 * Minutes used against the plan quota.
 *
 * The fill is capped at 100% while the label keeps telling the truth: a tenant
 * 40% over plan should see a full bar and "3,500 / 2,500 · 1,000 over", not a
 * bar overflowing its container. Spec §11 decision 2 is that we keep answering
 * and bill the overage, so going over is a normal state, not an error.
 */
export function UsageBar({
  used,
  included,
}: {
  used: number;
  included: number;
}) {
  const pct = included > 0 ? (used / included) * 100 : 0;
  const over = Math.max(0, used - included);
  const remaining = Math.max(0, included - used);

  return (
    <>
      <div className="usage-track">
        <div
          className="usage-fill"
          style={{
            width: `${Math.min(100, pct)}%`,
            // Over plan is not a failure, but it should read differently.
            background: over > 0 ? "var(--warning)" : undefined,
          }}
        />
      </div>
      <div className="usage-foot">
        <span>{used.toLocaleString()} min used</span>
        <span>
          {over > 0
            ? `${over.toLocaleString()} min over plan`
            : `${remaining.toLocaleString()} min remaining`}
        </span>
      </div>
    </>
  );
}
