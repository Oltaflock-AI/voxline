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
/**
 * Some figures have no good or bad direction. Average handle time is one: a
 * longer call can mean a better qualified enquiry or a caller going in
 * circles, and the portal should not pretend to know which.
 *
 * It still needs a mark. With two cards showing a coloured arrow and one
 * showing nothing, the third reads as a rendering fault rather than as a
 * deliberate "no verdict".
 */
const Flat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M5 12h14" />
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
          {/*
            The grey cards get a tooltip saying why they are grey. A colour
            that is missing and a colour that is withheld look identical, and
            the first thing anyone asks about this row is why one number is
            not green like the others.
          */}
          <span
            className={`delta ${kpi.dir}${kpi.dir === "flat" && kpi.neutralWhy ? " tip" : ""}`}
            data-tip={kpi.dir === "flat" ? kpi.neutralWhy : undefined}
          >
            {kpi.dir === "up" && <ArrowUp />}
            {kpi.dir === "down" && <ArrowDown />}
            {kpi.dir === "flat" && <Flat />}
            {kpi.delta}
          </span>
          <span className="kpi-note">{kpi.note}</span>
        </span>
        {/*
          Rendered tooltip, not the browser's. A native `title` is drawn by the
          OS: it waits about a second, gives no sign beforehand that it exists,
          and cannot be screenshotted, so there is no way to prove it works.
          This one is part of the page, appears at once, and can be tested.
        */}
        {kpi.sparkTitle ? (
          <span className="tip" data-tip={kpi.sparkTitle}>
            <Sparkline data={kpi.spark} title={kpi.sparkTitle} />
          </span>
        ) : (
          <Sparkline data={kpi.spark} />
        )}
      </div>
      {kpi.breakdown && (
        <div className="kpi-breakdown">
          <span>
            <b>{kpi.breakdown.value}</b>
            {kpi.breakdown.label}
          </span>
        </div>
      )}
    </div>
  );
}
