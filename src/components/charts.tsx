import { useId } from "react";

/**
 * Spec §3: "The v2 sparklines and bars are 40 lines of SVG, do not pull in a
 * library for them." These are ports of the prototype's `spark()` and
 * `renderVolume()`. They are Server Components — SVG is just markup, none of
 * this needs to reach the browser as JavaScript.
 */

export function Sparkline({ data }: { data: number[] }) {
  const gradientId = useId();
  const W = 100,
    H = 30,
    P = 3;

  if (data.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const pts = data.map((v, i) => {
    const x = P + (i * (W - P * 2)) / (data.length - 1);
    const y = H - P - ((v - min) / span) * (H - P * 2);
    return [x, y] as const;
  });

  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${W - P} ${H} L${P} ${H} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="1.9" fill="var(--accent)" />
    </svg>
  );
}

/** Call volume. Spec §6.2: peak day highlighted, value labels above each bar. */
export function BarChart({ data }: { data: { d: string; v: number }[] }) {
  const max = Math.max(...data.map((d) => d.v), 0);

  return (
    <div className="bars">
      {data.map((d, i) => (
        <div
          key={`${d.d}-${i}`}
          className={`bar-col${d.v === max && max > 0 ? " peak" : ""}`}
        >
          <span className="bar-v num">{d.v}</span>
          {/* Spec §7.9: "every number that can be zero renders correctly at
              zero, including the charts." A zero bar keeps a 6% stub so the
              column still reads as a column rather than vanishing. */}
          <div
            className="bar"
            style={{ height: max > 0 ? `${Math.max(6, (d.v / max) * 100)}%` : "6%" }}
          />
          <span className="bar-d">{d.d}</span>
        </div>
      ))}
    </div>
  );
}

/** Segmented proportion bar + the list with counts and percentages. */
export function OutcomeBars({
  outcomes,
}: {
  outcomes: { outcome: string; label: string; n: number; color: string }[];
}) {
  const total = outcomes.reduce((a, o) => a + o.n, 0);

  return (
    <>
      <div className="seg">
        {total > 0 &&
          outcomes.map((o) => (
            <i
              key={o.outcome}
              style={{ width: `${((o.n / total) * 100).toFixed(1)}%`, background: o.color }}
            />
          ))}
      </div>
      <div>
        {outcomes.map((o) => (
          <div className="out-row" key={o.outcome}>
            <span className="out-dot" style={{ background: o.color }} />
            <span className="n">{o.label}</span>
            <span className="v num">{o.n}</span>
            <span className="p num">
              {total ? Math.round((o.n / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
