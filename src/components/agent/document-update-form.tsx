"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  submitDocumentUpdate,
  type AgentRequestState,
  type UploadedFile,
} from "@/app/app/[tenant]/agent/request-actions";
import { DocumentUpload } from "./document-upload";

const initial: AgentRequestState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn sm" type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send update"}
    </button>
  );
}

/**
 * Replace the documents a live agent answers from.
 *
 * A request rather than a direct swap, and not for convenience: we push these
 * into Sarvam's knowledge base by hand, so a file changed silently here would
 * leave the portal showing one price list while the agent quotes another on the
 * phone. The note is the part that makes the update actionable — "new winter
 * pricing, Bali package withdrawn" tells us what to change and what to remove.
 */
export function DocumentUpdateForm({
  tenantSlug,
  tenantId,
}: {
  tenantSlug: string;
  tenantId: string;
}) {
  const [state, action] = useActionState(submitDocumentUpdate, initial);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [open, setOpen] = useState(false);
  const formId = useId();

  // One id for the life of this form, so files uploaded before submit are
  // filed under the request they belong to.
  const [requestId] = useState(() => crypto.randomUUID());

  if (state.ok) {
    return (
      <div className="card card-pad doc-update-done">
        <span className="ring">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <div>
          <b>Documents received</b>
          <p>
            We will update what your agent knows and confirm once the change is
            live on your calls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h3>Documents the agent answers from</h3>
          <span className="card-sub">
            Price lists, packages and guides your agent uses on calls
          </span>
        </div>
        {!open && (
          <button className="btn-ghost sm" type="button" onClick={() => setOpen(true)}>
            Update documents
          </button>
        )}
      </div>

      {!open ? (
        <p className="doc-privacy" style={{ marginTop: 4 }}>
          Send us a new version whenever your pricing or packages change. We
          update the agent and confirm when it is live on your calls.
        </p>
      ) : (
        <form action={action} style={{ marginTop: 4 }}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="files" value={JSON.stringify(files)} />

          <DocumentUpload
            tenantId={tenantId}
            requestId={requestId}
            onChange={setFiles}
          />

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor={`${formId}-note`}>
              What changed? <span className="req">*</span>
            </label>
            <textarea
              className="input"
              id={`${formId}-note`}
              name="note"
              required
              placeholder="New winter pricing from 1 November. We have withdrawn the Bali package, so please stop the agent quoting it."
            />
          </div>

          {state.error && (
            <div className="auth-err show" role="alert">
              {state.error}
            </div>
          )}

          <div className="request-actions" style={{ marginTop: 4 }}>
            <button
              className="btn-ghost sm"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <Submit />
          </div>
        </form>
      )}
    </div>
  );
}
