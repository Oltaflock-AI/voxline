"use client";

import { useEffect, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { submitChangeRequest } from "@/app/app/[tenant]/agent/actions";
import { useToast } from "./toast";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn sm" type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send request"}
    </button>
  );
}

export function ChangeRequestModal({ tenantSlug }: { tenantSlug: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  /**
   * The form's action is this wrapper rather than the Server Action directly.
   *
   * The obvious version — useActionState plus an effect that closes the modal
   * when state.ok flips — is an anti-pattern (and eslint's
   * react-hooks/set-state-in-effect rejects it): it renders once with the
   * success state, then immediately re-renders to close. Awaiting the action
   * here means success and dismissal happen in one pass.
   *
   * useFormStatus still works — Submit is inside the <form>, and pending is
   * true for as long as this async function is running.
   */
  async function handle(formData: FormData) {
    const result = await submitChangeRequest({ error: null, ok: false }, formData);
    if (result.ok) {
      setError(null);
      setOpen(false);
      // Spec §7.9: every asynchronous action produces a toast.
      toast("Request sent. We review every request within one business day.");
    } else {
      setError(result.error);
    }
  }

  // Spec §7.9: Escape closes any overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
  }

  /**
   * Rendered into <body> via a portal, NOT in place.
   *
   * `.scrim` is position:fixed and expects to cover the viewport. In place it
   * did not: it came out 970×696 inside a 1300×800 window, clipped to the card,
   * with page text visible beside the dialog.
   *
   * The cause is three steps removed from anything here. `.panel` carries
   * `animation: fade .28s ease both`, whose final keyframe sets
   * `transform: none` — and even an identity transform makes an element the
   * containing block for position:fixed descendants, so "fixed" resolved
   * against the panel instead of the viewport. The prototype never hit it
   * because its modal markup sat at the document root.
   *
   * A portal is the durable fix: the dialog leaves the transformed subtree
   * entirely, so no future ancestor style can clip it again.
   */
  const dialog = (
    <div
          className="scrim open"
          onClick={(e) => e.target === e.currentTarget && close()}
          role="dialog"
          aria-modal="true"
          aria-label="Request a change"
        >
          <div className="modal">
            <h3>Request a change</h3>
            <div className="sub">
              Tell us what the agent should do differently. Our team reviews
              every request within one business day.
            </div>

            <form action={handle}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <textarea
                className="input"
                name="message"
                required
                autoFocus
                placeholder="e.g. Please also ask callers whether they have travelled with us before, and route Italy inquiries to Marco."
              />
              {error && (
                <p
                  style={{ color: "var(--negative)", fontSize: 13, marginTop: 8 }}
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button className="btn-ghost sm" type="button" onClick={close}>
                  Cancel
                </button>
                <Submit />
              </div>
            </form>
          </div>
        </div>
  );

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>
        Request a change
      </button>
      {/* No "have we mounted yet" guard needed: `open` only becomes true from
          a click, which cannot happen before hydration, so document.body is
          always there by the time this renders. */}
      {open && createPortal(dialog, document.body)}
    </>
  );
}
