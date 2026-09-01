import { WaveLoader } from "@/components/logo";

/**
 * Where an onboarding request has got to.
 *
 * Concierge onboarding does not fail because it is manual — it fails because it
 * is silent. An agency that has filled in the form and heard nothing cannot
 * tell whether they go live tomorrow or next month, and that is what makes a
 * managed service feel like being ignored. This is the cheapest fix for that.
 *
 * Stages come from the `agent_request_stage` enum. `cancelled` and `completed`
 * never reach here: the page only renders this for a request still in flight.
 */
const STAGES = [
  {
    key: "submitted",
    title: "Request received",
    body: "We have your answers and will review them shortly.",
  },
  {
    key: "in_review",
    title: "Under review",
    body: "We are reading through what you need and will come back if anything is unclear.",
  },
  {
    key: "building",
    title: "Building your agent",
    body: "Writing the script, setting the voice and loading your documents.",
  },
  {
    key: "test_ready",
    title: "Ready for a test call",
    body: "Your Voxline contact will arrange a call so you can hear it before anyone else does.",
  },
  {
    key: "number_pending",
    title: "Connecting your phone number",
    body: "We are arranging the number. This step takes longest because it depends on the phone provider rather than on us.",
  },
] as const;

export function RequestProgress({
  stage,
  statusNote,
  submittedAt,
}: {
  stage: string;
  statusNote: string | null;
  submittedAt: string;
}) {
  const currentIndex = STAGES.findIndex((s) => s.key === stage);
  // An unrecognised stage should not blank the page — treat it as the start.
  const active = currentIndex === -1 ? 0 : currentIndex;

  return (
    <div className="card card-pad request-progress">
      <div className="card-head">
        <div>
          <span className="lab">Onboarding</span>
          <h3>We are setting up your agent</h3>
        </div>
        <span className="card-sub">
          Requested{" "}
          {new Date(submittedAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>

      <ol className="progress-steps">
        {STAGES.map((s, i) => {
          const state = i < active ? "done" : i === active ? "current" : "todo";
          return (
            <li key={s.key} className={`progress-step is-${state}`}>
              <span className="progress-mark" aria-hidden="true">
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : state === "current" ? (
                  <WaveLoader height={12} />
                ) : (
                  <span className="progress-dot" />
                )}
              </span>
              <div className="progress-copy">
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
              <span className="sr-only">
                {state === "done"
                  ? "Completed"
                  : state === "current"
                    ? "In progress"
                    : "Not started"}
              </span>
            </li>
          );
        })}
      </ol>

      {statusNote && (
        <div className="notice" style={{ marginTop: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <p>
            <b>From your Voxline contact.</b> {statusNote}
          </p>
        </div>
      )}
    </div>
  );
}
