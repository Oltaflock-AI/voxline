"use client";

import { useState } from "react";
import { OUTCOME_META } from "@/lib/outcomes";
import {
  formatDuration,
  formatWhen,
  hasBrief,
  parseAnalysis,
  parseTranscript,
  type CallRowData,
} from "@/lib/calls";
import { Transcript } from "./transcript";
import { TripBrief } from "./trip-brief";
import { AudioPlayer } from "./audio-player";
import { WaveLoader } from "@/components/logo";

/**
 * Deterministic bar heights for the mini waveform — a port of the prototype's
 * `bars(n, seed)`. Deterministic matters: Math.random() here would render
 * different heights on the server and the client and trip a hydration mismatch.
 */
function miniWave(seed: number) {
  return Array.from({ length: 11 }, (_, i) => 26 + ((i * 37 + seed * 13) % 72));
}

function CallRow({
  call,
  index,
  tenantSlug,
  open,
  onToggle,
}: {
  call: CallRowData;
  index: number;
  tenantSlug: string;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = call.outcome ? OUTCOME_META[call.outcome] : null;
  const analysis = parseAnalysis(call.analysis);
  const turns = parseTranscript(call.transcript);

  return (
    <div className={`call ${meta?.cssKey ?? ""}${open ? " open" : ""}`}>
      <button className="call-head" onClick={onToggle} aria-expanded={open}>
        <span className="wave" aria-hidden="true">
          {miniWave(index).map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </span>

        <span className="call-who">
          {/* Spec §6.3: caller name or "Unknown Caller" */}
          <b>{call.caller_name ?? "Unknown Caller"}</b>
          <span>{formatWhen(call.started_at)}</span>
        </span>

        {meta && (
          <span className={`badge ${meta.badge}`}>
            <span className="dot" />
            {meta.short}
          </span>
        )}

        <span className="call-dur">{formatDuration(call.duration_seconds)}</span>

        <svg
          className="call-caret"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className="call-body">
        {/* Only mounted while open: an unopened row should not fetch a signed
            URL or attach an <audio> element it will never use. */}
        {open && (
          <>
            <AudioPlayer
              callId={call.id}
              durationSeconds={call.duration_seconds}
              hasRecording={Boolean(call.recording_path)}
            />
            <Transcript turns={turns} />
            {hasBrief(analysis) && (
              <TripBrief
                analysis={analysis}
                leadHref={`/app/${tenantSlug}/pipeline?call=${call.id}`}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Spec §6.3: "Only one row open at a time." That is why the open state lives
 * here on the list rather than inside each row — a row cannot know that
 * another row just opened.
 */
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
  const [openId, setOpenId] = useState<string | null>(null);

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
          open={openId === call.id}
          onToggle={() => setOpenId(openId === call.id ? null : call.id)}
        />
      ))}
    </div>
  );
}
