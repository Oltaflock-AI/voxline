import type { CallOutcome } from "@/lib/outcomes";
import type { CallAnalysis } from "@/lib/calls";
import { BAND_META, bandFor, explainScore } from "@/lib/score";

/**
 * The lead score with its working shown.
 *
 * The dashboard this idea came from displays a bare number, which is fine for
 * a team that built the scoring and knows what feeds it. An agency does not,
 * and a number nobody can interrogate is a number nobody sorts their morning
 * callbacks by. So every component is broken out with the reason it scored
 * what it did — and, when points are missing, what would earn them.
 */
export function ScorePanel({
  score,
  outcome,
  analysis,
  durationSeconds,
}: {
  score: number | null;
  outcome: CallOutcome | null;
  analysis: CallAnalysis;
  durationSeconds: number;
}) {
  const band = bandFor(score);
  const meta = BAND_META[band];
  const { parts } = explainScore({
    outcome,
    analysis,
    duration_seconds: durationSeconds,
  });

  return (
    <section className={`card card-pad score-panel ${band}`} aria-labelledby="score-title">
      <div className="score-head">
        <div className="score-dial" role="img" aria-label={`Lead score ${score ?? 0} out of 100`}>
          <strong className="num">{score ?? 0}</strong>
          <span>/ 100</span>
        </div>
        <div className="score-intro">
          <span className="lab">Lead score</span>
          <h3 id="score-title">{meta.label}</h3>
          <p>{meta.blurb}</p>
        </div>
      </div>

      <ul className="score-parts">
        {parts.map((p) => (
          <li key={p.label}>
            <div className="score-part-head">
              <span className="score-part-label">{p.label}</span>
              <span className="score-part-points num">
                {p.points}
                <span className="score-part-max">/{p.max}</span>
              </span>
            </div>
            <div
              className="score-bar"
              role="presentation"
              style={{ ["--fill" as string]: `${(p.points / p.max) * 100}%` }}
            >
              <i />
            </div>
            <span className="score-part-detail">{p.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
