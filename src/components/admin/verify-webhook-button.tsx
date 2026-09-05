"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { verifyAgentWebhook, type AdminFormState } from "@/app/admin/actions";

const initial: AdminFormState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-ghost sm" type="submit" disabled={pending}>
      {pending ? "Verifying…" : "Verify webhook"}
    </button>
  );
}

/**
 * Confirm a Sarvam webhook that already points at Voxline — the path for an
 * agent whose URL was pasted into Sarvam's console by hand, or one linked
 * before verification existed. Never re-links or shows any URL: it only asks
 * Sarvam what it already has.
 */
export function VerifyWebhookButton({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(verifyAgentWebhook, initial);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={action}>
      <input type="hidden" name="agentId" value={agentId} />
      <Submit />
      {state.error && (
        <div className="auth-err show" role="alert">
          {state.error}
        </div>
      )}
      {state.ok && <p className="admin-saved">Verified.</p>}
    </form>
  );
}
