/**
 * Deterministic waveform motif used by call rows and the call-detail masthead.
 * The seeded arithmetic keeps server and client renders identical.
 */
export function CallWave({ seed = 0, bars = 11 }: { seed?: number; bars?: number }) {
  return (
    <span className="wave" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const height = 26 + ((i * 37 + seed * 13) % 72);
        return <span key={i} style={{ height: `${height}%` }} />;
      })}
    </span>
  );
}
