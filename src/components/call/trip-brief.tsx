import Link from "next/link";
import type { CallAnalysis } from "@/lib/calls";

/**
 * The structured trip brief (spec §6.3): destination, dates, party, budget and
 * occasion, plus a link through to the lead.
 *
 * The field names here are the same six keys the voice agent emits and the
 * same six stored in `calls.analysis`. That parity is deliberate — it is what
 * lets the webhook write the column without a translation layer.
 */
export function TripBrief({
  analysis,
  leadHref,
}: {
  analysis: CallAnalysis;
  leadHref?: string;
}) {
  const fields: [string, string | null | undefined][] = [
    ["Destination", analysis.destination],
    ["Dates", analysis.dates],
    ["Party", analysis.party_size],
    ["Budget", analysis.budget],
    ["Occasion", analysis.occasion],
  ];
  const present = fields.filter(([, v]) => v);

  return (
    <div className="brief">
      <span className="lab">Trip brief</span>
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
          Open in trip pipeline
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
