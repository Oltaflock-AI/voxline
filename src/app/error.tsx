"use client";

import { useEffect } from "react";

/**
 * Error boundary for anything that throws while rendering.
 *
 * There are real paths into this: getOverviewMetrics() rethrows a failed
 * Supabase call, and any transient database or auth blip does the same. Next's
 * default is an unstyled stack-trace page in dev and a bare "something went
 * wrong" in production, with no way forward except the back button.
 *
 * `reset()` re-renders the segment without a full page load, which is usually
 * all a transient failure needs.
 *
 * Must be a Client Component — error boundaries rely on React state, and this
 * has to keep working when the server render is the thing that failed.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry is the intended home for this (spec §3); until it is wired, the
    // server console is what we have. `digest` is the id Next puts in the
    // server log, so it is the thread back to the real stack trace.
    console.error("[voxline] render error", error.digest, error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div className="empty" style={{ border: "none" }}>
          <b>Something went wrong on our side</b>
          <p>
            This is usually temporary. Try again, and if it keeps happening let
            us know and we&rsquo;ll look into it.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 9,
            justifyContent: "center",
            marginTop: 18,
          }}
        >
          <button className="btn sm" onClick={reset}>
            Try again
          </button>
          <a className="btn-ghost sm" href="mailto:support@voxline.io">
            Email support
          </a>
        </div>

        {/* The digest is the only thing that ties a user's report to a line in
            the server log — production strips the message itself. */}
        {error.digest && (
          <p
            className="mono"
            style={{ marginTop: 18, fontSize: 10.5, color: "var(--faint)" }}
          >
            REF {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
