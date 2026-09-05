import Link from "next/link";
import {
  BRIEF_FIELDS,
  BRIEF_TITLE,
  type AgentVertical,
  type CallAnalysis,
} from "@/lib/calls";

/**
 * The structured brief (spec §6.3), plus a link through to the lead.
 *
 * ONE component for both verticals, not two. The markup is a contract with
 * `.brief` / `.brief-grid` / `.brief-link` in globals.css, and duplicating it
 * for real estate would mean two files drifting from one stylesheet. The only
 * thing that varies is which fields to show and what to call the card, and
 * both of those live in BRIEF_FIELDS / BRIEF_TITLE in lib/calls.ts.
 *
 * Those field names are the same keys the voice agent emits and the same keys
 * stored in `calls.analysis`. That parity is deliberate — it is what lets the
 * webhook write the column without a translation layer.
 */
export function TripBrief({
  analysis,
  vertical,
  leadHref,
}: {
  analysis: CallAnalysis;
  vertical: AgentVertical;
  leadHref?: string;
}) {
  const present = BRIEF_FIELDS[vertical]
    .map(([key, label]) => [label, analysis[key]] as const)
    .filter(([, v]) => v);

  return (
    <div className="brief">
      <span className="lab">{BRIEF_TITLE[vertical]}</span>
      <div className="brief-grid">
        {present.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>

      {analysis.notes && (
        <p
          style={{
            marginTop: 12,
            fontSize: 13,
            color: "var(--text-2)",
            lineHeight: 1.55,
          }}
        >
          {analysis.notes}
        </p>
      )}

      {leadHref && (
        <Link className="brief-link" href={leadHref}>
          Open in pipeline
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      )}
    </div>
  );
}
