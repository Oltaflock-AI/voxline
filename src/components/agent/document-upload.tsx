"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UploadedFile } from "@/app/app/[tenant]/agent/request-actions";

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sanitise a filename into a storage key.
 *
 * Storage paths are not filenames: a slash would silently create a folder and
 * put the object outside the `<tenant>/<request>/` prefix the RLS policy checks.
 * The display name is kept separately in `agent_request_files.filename`, so
 * nothing is lost by being strict here.
 */
function safeKey(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Uploads straight from the browser to Supabase Storage.
 *
 * Files go direct rather than through a Server Action because a Server Action
 * posts the whole body to our server first — ten megabytes of PDF through a
 * serverless function, for no benefit. The bucket's own policy already limits
 * writes to the uploader's tenant folder.
 *
 * The size and type checks below are a courtesy so the user learns immediately
 * rather than after a failed upload. They are NOT the control: the bucket
 * enforces both server-side, which is the only place a check counts.
 */
export function DocumentUpload({
  tenantId,
  requestId,
  onChange,
}: {
  tenantId: string;
  requestId: string;
  onChange: (files: UploadedFile[]) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function update(next: UploadedFile[]) {
    setFiles(next);
    onChange(next);
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);

    const incoming = Array.from(list);
    if (files.length + incoming.length > MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files.`);
      return;
    }

    const oversized = incoming.find((f) => f.size > MAX_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is larger than 10 MB.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const accepted: UploadedFile[] = [];

    for (const file of incoming) {
      // Prefix with a short random string so two files with the same name do
      // not overwrite each other.
      const key = `${Math.random().toString(36).slice(2, 8)}-${safeKey(file.name)}`;
      const path = `${tenantId}/${requestId}/${key}`;

      const { error: uploadError } = await supabase.storage
        .from("agent-documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });

      if (uploadError) {
        setError(
          `We could not upload "${file.name}". It may be a file type we do not accept.`
        );
        continue;
      }

      accepted.push({
        storagePath: path,
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
      });
    }

    setBusy(false);
    if (accepted.length > 0) update([...files, ...accepted]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(target: UploadedFile) {
    const supabase = createClient();
    await supabase.storage.from("agent-documents").remove([target.storagePath]);
    update(files.filter((f) => f.storagePath !== target.storagePath));
  }

  return (
    <div className="doc-upload">
      <div
        className={`doc-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5M12 3v13" />
        </svg>
        <p>
          Drag files here, or{" "}
          <button
            type="button"
            className="doc-browse"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            browse
          </button>
        </p>
        <span className="doc-hint">
          PDF, Word, Excel, CSV or images. Up to 10 MB per file and {MAX_FILES}{" "}
          files in total.
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => void addFiles(e.currentTarget.files)}
          hidden
        />
      </div>

      {busy && <p className="doc-status">Uploading…</p>}
      {error && <p className="doc-error">{error}</p>}

      {files.length > 0 && (
        <ul className="doc-list">
          {files.map((f) => (
            <li key={f.storagePath}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              </svg>
              <span className="doc-name">{f.filename}</span>
              <span className="doc-size">{humanSize(f.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => void remove(f)}
                aria-label={`Remove ${f.filename}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
