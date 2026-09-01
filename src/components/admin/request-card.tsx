"use client";

import { useState, useTransition } from "react";
import { getRequestFileUrl, setRequestStage } from "@/app/admin/actions";

const STAGES = [
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "Under review" },
  { key: "building", label: "Building agent" },
  { key: "test_ready", label: "Ready for test call" },
  { key: "number_pending", label: "Connecting number" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

/** Field order matches the form the agency filled in, so answers read in the
 *  order they were asked rather than however jsonb happened to store them. */
const FIELDS: [string, string][] = [
  ["agency_summary", "What the agency does"],
  ["top_requests", "Most common caller questions"],
  ["purpose", "Agent's job"],
  ["direction", "Call direction"],
  ["greeting", "Greeting"],
  ["languages", "Languages"],
  ["voice", "Voice"],
  ["must_capture", "Must ask every caller"],
  ["outreach_goal", "Successful outbound call"],
  ["hours", "Opening hours"],
  ["after_hours", "Outside hours"],
  ["escalation_number", "Transfer urgent calls to"],
  ["existing_number", "Their current number"],
  ["existing_number_action", "What to do with it"],
];

type RequestFile = {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  storage_path: string;
};

export type AdminRequest = {
  id: string;
  kind: string;
  stage: string;
  payload: unknown;
  note: string | null;
  status_note: string | null;
  created_at: string;
  tenants: { name: string; slug: string } | null;
  agent_request_files: RequestFile[] | null;
};

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One request, with everything needed to act on it without leaving the page.
 *
 * A Client Component because the two things that make this usable are both
 * interactive: opening a document needs a signed link minted on demand (never
 * baked into a page listing every agency's pricing), and advancing the stage
 * should not reload the world.
 */
export function RequestCard({ request }: { request: AdminRequest }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const payload = (request.payload ?? {}) as Record<string, string>;
  const answered = FIELDS.filter(([k]) => payload[k]?.trim());
  const files = request.agent_request_files ?? [];
  const isNewAgent = request.kind === "new_agent";
  const currentIndex = STAGES.findIndex((s) => s.key === request.stage);

  async function openFile(path: string) {
    setFileError(null);
    const res = await getRequestFileUrl(path);
    if (!res.url) {
      setFileError(res.error);
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  function advance(stage: string) {
    const form = new FormData();
    form.set("id", request.id);
    form.set("stage", stage);
    if (note.trim()) form.set("statusNote", note.trim());
    startTransition(async () => {
      await setRequestStage(form);
      setNote("");
    });
  }

  return (
    <article className={`card card-pad admin-request${isPending ? " is-pending" : ""}`}>
      <div className="admin-request-head">
        <div>
          <span className={`badge ${isNewAgent ? "acc" : ""}`}>
            {isNewAgent ? "New agent" : "Document update"}
          </span>
          <h3>{request.tenants?.name ?? "Unknown agency"}</h3>
          <span className="mono admin-when">
            Requested {new Date(request.created_at).toLocaleString()}
          </span>
        </div>
        <div className="admin-request-stage">
          <span className="lab">Stage</span>
          <select
            value={request.stage}
            disabled={isPending}
            onChange={(e) => advance(e.currentTarget.value)}
            aria-label={`Stage for ${request.tenants?.name ?? "this request"}`}
          >
            {STAGES.map((s, i) => (
              <option key={s.key} value={s.key}>
                {i < currentIndex ? "✓ " : ""}
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {request.note && (
        <div className="admin-request-note">
          <span className="lab">What changed</span>
          <p>{request.note}</p>
        </div>
      )}

      {isNewAgent && (
        <>
          <button
            type="button"
            className="admin-disclose"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} the {answered.length}{" "}
        {answered.length === 1 ? "answer" : "answers"} they gave
          </button>

          {open && (
            <dl className="admin-answers">
              {answered.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{payload[key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {files.length > 0 && (
        <div className="admin-files">
          <span className="lab">
            {files.length} {files.length === 1 ? "document" : "documents"}
          </span>
          <ul>
            {files.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => void openFile(f.storage_path)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  </svg>
                  {f.filename}
                  <span className="admin-file-size">{humanSize(f.size_bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
          {fileError && <p className="admin-file-error">{fileError}</p>}
        </div>
      )}

      <div className="admin-request-foot">
        <input
          className="input sm"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="Optional note for the agency. They see this on their progress tracker"
          maxLength={500}
          aria-label="Note for the agency"
        />
      </div>

      {request.status_note && (
        <p className="admin-existing-note">
          <b>They currently see:</b> {request.status_note}
        </p>
      )}
    </article>
  );
}
