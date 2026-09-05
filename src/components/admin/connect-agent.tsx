"use client";

import { useActionState, useEffect, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  linkAgent,
  listSarvamDeployments,
  type AdminFormState,
  type DeploymentListState,
} from "@/app/admin/actions";
import type { VoiceProvider } from "@/lib/ingest";
import { PROVIDER_CAPABILITIES, PROVIDER_ORDER } from "@/lib/providers/capabilities";
import type { SarvamDeployment } from "@/lib/providers/sarvam-client";

const initial: AdminFormState = { error: null, ok: false };

/**
 * Sarvam refuses to edit a running deployment: setting the webhook on an
 * `active` one returns 422 every time. The list already knows each
 * deployment's status, so offering the button anyway is offering a guaranteed
 * failure — the spec's own rule for this panel is "never a dead button, always
 * the honest state".
 */
function LinkButton({ blockedReason }: { blockedReason: string | null }) {
  const { pending } = useFormStatus();
  if (blockedReason) {
    return (
      <button className="btn sm" type="button" disabled title={blockedReason}>
        Connect
      </button>
    );
  }
  return (
    <button className="btn sm" type="submit" disabled={pending}>
      {pending ? "Connecting…" : "Connect"}
    </button>
  );
}

/**
 * Connect an existing provider agent to this agency.
 *
 * The picker shows all three providers, but only the ones whose capability
 * table says `connect` are enabled — the others explain what to do instead.
 * That is the deal the spec makes: never a dead button, always the honest
 * path.
 *
 * Deployments are loaded only when the admin asks for them, via an explicit
 * button — never on mount and never on provider change. The list is a live
 * call to Sarvam: an admin opening an agency page to check a phone number
 * should not trigger one, and the test suite (which visits this page a lot)
 * must not hit Sarvam just by rendering.
 */
export function ConnectAgent({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<VoiceProvider>("sarvam");
  const [list, setList] = useState<DeploymentListState | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, action] = useActionState(linkAgent, initial);

  const caps = PROVIDER_CAPABILITIES[provider];

  const load = useCallback(() => {
    startLoading(async () => {
      setList(await listSarvamDeployments());
    });
  }, []);

  useEffect(() => {
    // The server action revalidated the page; refresh so the agent card
    // replaces this one without a manual reload.
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <section className="card card-pad">
      <div className="card-head">
        <div>
          <h3>Connect a voice agent</h3>
          <span className="card-sub">
            Adopt an agent that already exists at a provider. Voxline wires the
            post-call webhook and confirms it took.
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="ca-provider">Provider</label>
        <select
          className="input"
          id="ca-provider"
          value={provider}
          // Reset here, not in the effect above: react-hooks/set-state-in-effect
          // forbids synchronous setState in an effect body, but event handlers
          // are exempt, and this is the only place a provider switch is known.
          onChange={(e) => {
            setProvider(e.target.value as VoiceProvider);
            setList(null);
          }}
        >
          {PROVIDER_ORDER.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_CAPABILITIES[p].label}
              {PROVIDER_CAPABILITIES[p].connect ? "" : " — not yet"}
            </option>
          ))}
        </select>
        <p className="field-hint">{caps.note}</p>
      </div>

      {caps.connect && (
        <>
          <button
            type="button"
            className="btn-ghost sm"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading…" : list ? "Reload deployments" : "Load deployments from Sarvam"}
          </button>

          {loading && <p className="admin-muted">Loading deployments from Sarvam…</p>}

          {!loading && list?.error && (
            <div className="auth-err show" role="alert">
              {list.error}
            </div>
          )}

          {!loading && list && !list.error && list.deployments.length === 0 && (
            <div className="empty">
              <b>No deployments in the Sarvam workspace</b>
              <p>Create and deploy the agent in Sarvam&rsquo;s console first, then come back.</p>
            </div>
          )}

          {!loading && list && list.deployments.length > 0 && (
            <ul className="admin-members">
              {list.deployments.map((d) => (
                <DeploymentRow key={d.deployment_id} d={d} tenantId={tenantId} action={action} />
              ))}
            </ul>
          )}

          {state.error && (
            <div className="auth-err show" role="alert">
              {state.error}
            </div>
          )}
          {state.ok && <p className="admin-saved">Connected. Webhook confirmed by Sarvam.</p>}
        </>
      )}
    </section>
  );
}

function DeploymentRow({
  d,
  tenantId,
  action,
}: {
  d: SarvamDeployment;
  tenantId: string;
  action: (formData: FormData) => void;
}) {
  const webhookState = d.webhook_url
    ? d.webhook_url.includes("/api/webhooks/sarvam/")
      ? "webhook → Voxline"
      : "webhook → elsewhere"
    : "no webhook";

  // Sarvam rejects a webhook write to a running deployment. Say so here rather
  // than letting the click find out.
  const blockedReason =
    d.status === "active"
      ? "Sarvam only allows edits to a paused deployment. Pause it in the Sarvam console, then Connect."
      : null;

  return (
    <li>
      <span>
        <b>{d.name ?? d.deployment_id}</b>
        <span className="admin-muted">
          {" "}
          · <span className="mono">{d.app_id}</span> v{d.app_version}
          {d.phone_numbers.length > 0 && <> · {d.phone_numbers.join(", ")}</>}
        </span>
        <br />
        <span className={`badge ${d.webhook_url ? "" : "acc"}`}>{webhookState}</span>{" "}
        <span className="badge">{d.status ?? "unknown"}</span>
        {blockedReason && (
          <>
            <br />
            <span className="admin-muted" style={{ fontSize: "12px" }}>
              Pause this deployment in Sarvam before connecting it.
            </span>
          </>
        )}
      </span>
      <form action={action}>
        <input type="hidden" name="provider" value="sarvam" />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="deploymentId" value={d.deployment_id} />
        <LinkButton blockedReason={blockedReason} />
      </form>
    </li>
  );
}
