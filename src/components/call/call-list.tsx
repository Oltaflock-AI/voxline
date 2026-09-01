import Link from "next/link";
import { OUTCOME_META } from "@/lib/outcomes";
import {
  formatDuration,
  formatWhen,
  parseAnalysis,
  type CallRowData,
} from "@/lib/calls";
import { WaveLoader } from "@/components/logo";
import { CallWave } from "./call-wave";
import { ScoreBadge } from "./score-badge";

/**
 * The one line worth reading before deciding whether to open a call.
 *
 * Borrowed from the Sarthak Singapore dashboard, which puts a summary sentence
 * on every call row so the list can be skimmed. Ours is built from the trip
 * brief rather than prose: "Kerala backwaters · Late November · 4 travellers"
 * tells an agent more in three words than a generated sentence does, and it
 * costs nothing — the fields are already on the row.
 */
function briefLine(call: CallRowData): string | null {
  const a = parseAnalysis(call.analysis);
  const parts = [a.destination, a.dates, a.party_size, a.budget].filter(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function CallRow({
  call,
  index,
  tenantSlug,
}: {
  call: CallRowData;
  index: number;
  tenantSlug: string;
}) {
  const meta = call.outcome ? OUTCOME_META[call.outcome] : null;
  const caller = call.caller_name ?? "Unknown Caller";
  const brief = briefLine(call);

  return (
    <div className={`call ${meta?.cssKey ?? ""}`}>
      <Link
        className="call-head"
        href={`/app/${tenantSlug}/calls/${call.id}`}
        aria-label={`Open call with ${caller}`}
      >
        <CallWave seed={index} />

        <span className="call-who">
          {/* Spec §6.3: caller name or "Unknown Caller" */}
          <b>{caller}</b>
          {/*
            The second line is ALWAYS rendered, and always exactly one line.

            It used to appear only when a trip brief existed, and to wrap freely
            when it did — so a list mixed one-line rows with three-line ones and
            the badges landed at a different height on every row. Scanning a
            column means the eye returning to the same spot each time, and it
            could not. Now every row is the same shape: the brief when there is
            one, the caller's number when there is not, truncated either way.
          */}
          <span className="call-brief">
            {brief ?? call.caller_phone ?? "No trip details captured"}
          </span>
        </span>

        {/* Wrapped together so the narrow-screen grid can place both badges in
            one cell. On desktop this is a plain flex child and looks the same
            as two loose badges did. */}
        <span className="call-tags">
          <ScoreBadge score={call.lead_score} />
          {meta && (
            <span className={`badge ${meta.badge}`}>
              <span className="dot" />
              {meta.short}
            </span>
          )}
        </span>

        <span className="call-dur">
          <span className="call-when">{formatWhen(call.started_at)}</span>
          {formatDuration(call.duration_seconds)}
        </span>

        <svg
          className="call-arrow"
          width="15"
          height="15"
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
  );
}

export function CallList({
  calls,
  tenantSlug,
  emptyTitle = "Nothing on this line yet",
  emptyBody = "No calls matched this filter in the last 7 days.",
}: {
  calls: CallRowData[];
  tenantSlug: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (calls.length === 0) {
    return (
      <div className="empty">
        <span className="ring">
          <WaveLoader height={16} />
        </span>
        <b>{emptyTitle}</b>
        <p>{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="call-list">
      {calls.map((call, i) => (
        <CallRow
          key={call.id}
          call={call}
          index={i}
          tenantSlug={tenantSlug}
        />
      ))}
    </div>
  );
}
