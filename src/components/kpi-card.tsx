import { Sparkline } from "./charts";
import { CountUp } from "./count-up";
import type { Kpi } from "@/lib/metrics";

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const ArrowDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

export function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="card kpi">
      <span className="lab">{kpi.label}</span>
      <div className="kpi-val">
        <b className="num">
          <CountUp value={kpi.value} />
        </b>
        {kpi.frac && <span className="frac num">{kpi.frac}</span>}
      </div>
      <div className="kpi-foot">
        <span className="meta">
          <span className={`delta ${kpi.dir}`}>
            {kpi.dir === "up" && <ArrowUp />}
            {kpi.dir === "down" && <ArrowDown />}
            {kpi.delta}
          </span>
          <span className="kpi-note">{kpi.note}</span>
        </span>
        <Sparkline data={kpi.spark} />
      </div>
    </div>
  );
}
