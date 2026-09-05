"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
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

function LinkButton() {
  const { pending } = useFormStatus();
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
 * Deployments are fetched on selection, not on mount: the list is a live call
 * to Sarvam, and an admin who opens an agency page to check a phone number
 * should not pay for it.
 */
export function ConnectAgent({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<VoiceProvider>("sarvam");
  const [list, setList] = useState<DeploymentListState | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, action] = useActionState(linkAgent, initial);

  const caps = PROVIDER_CAPABILITIES[provider];

  useEffect(() => {
    if (!caps.connect) return;
    startLoading(async () => {
      setList(await listSarvamDeployments());
    });
  }, [provider, caps.connect]);

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
          onChange={(e) => setProvider(e.target.value as VoiceProvider)}
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
          {loading && <p className="admin-muted">Loading deployments from Sarvam…</p>}

          {list?.error && (
            <div className="auth-err show" role="alert">
              {list.error}
            </div>
          )}

          {list && !list.error && list.deployments.length === 0 && (
            <div className="empty">
              <b>No deployments in the Sarvam workspace</b>
              <p>Create and deploy the agent in Sarvam&rsquo;s console first, then come back.</p>
            </div>
          )}

          {list && list.deployments.length > 0 && (
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
      </span>
      <form action={action}>
        <input type="hidden" name="provider" value="sarvam" />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="deploymentId" value={d.deployment_id} />
        <LinkButton />
      </form>
    </li>
  );
}
