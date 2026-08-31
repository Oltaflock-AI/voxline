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
      <p style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0 2px" }}>
        No transcript was captured for this call.
      </p>
    );
  }

  return (
    <>
      {turns.map((t, i) => (
        <div
          className={`turn${t.speaker === "Agent" ? " agent" : ""}`}
          key={`${t.ts}-${i}`}
        >
          <span className="sp">{t.speaker}</span>
          <p>{t.text}</p>
        </div>
      ))}
    </>
  );
}
