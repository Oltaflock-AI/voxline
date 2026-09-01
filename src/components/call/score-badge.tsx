import { BAND_META, bandFor } from "@/lib/score";

/**
 * The lead score, as a band plus its number.
 *
 * Both, not one or the other. The band is what someone scans a list by; the
 * number is what lets them rank two calls that are both "warm". Showing only
 * the band throws away the ordering the score exists to provide.
 */
export function ScoreBadge({
  score,
  size = "sm",
}: {
  score: number | null | undefined;
  size?: "sm" | "lg";
}) {
  const band = bandFor(score);
  const meta = BAND_META[band];

  return (
    <span
      className={`score-badge ${band} ${size}`}
      title={`${meta.label} lead · scored ${score ?? 0} out of 100`}
    >
      <span className="dot" />
      {meta.label}
      <span className="score-num">{score ?? 0}</span>
    </span>
  );
}
