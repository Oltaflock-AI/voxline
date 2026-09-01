import type { TranscriptTurn } from "@/lib/calls";

/**
 * Speaker-labelled transcript (spec §6.3).
 *
 * "Agent" turns get the `.agent` class, which is what the ported stylesheet
 * uses to tint them apart from the caller. Matching on the literal string is
 * what the prototype does; the webhook normalises Retell's speaker labels to
 * "Agent" / the caller's name on the way in, so the check holds.
 */
export function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="transcript-empty">
        <span className="transcript-empty-mark" aria-hidden="true">“</span>
        <b>No transcript captured</b>
        <p>Nothing was captured for this call, so there is no text to show.</p>
      </div>
    );
  }

  return (
    <div className="transcript-list">
      {turns.map((t, i) => (
        <div
          className={`turn${t.speaker === "Agent" ? " agent" : ""}`}
          key={`${t.ts}-${i}`}
        >
          <div className="turn-marker" aria-hidden="true">
            <span>{t.speaker === "Agent" ? "A" : "C"}</span>
          </div>
          <div className="turn-copy">
            <span className="sp">{t.speaker}</span>
            <p>{t.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
