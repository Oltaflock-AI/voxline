"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateAgent, type AdminFormState } from "@/app/admin/actions";
import {
  PROVIDER_CAPABILITIES,
  PROVIDER_ORDER,
} from "@/lib/providers/capabilities";

const initial: AdminFormState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn sm" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

/**
 * Edit the agent record — spec §6.7's "attach agent IDs and phone numbers".
 *
 * This is the config an AGENCY is deliberately not allowed to touch (spec §6.6:
 * a bad config breaks a live phone line). It is editable here because someone
 * has to be able to fix a mistyped provider ID without a database client, and
 * every save is written to the audit log.
 */
export function EditAgentForm({
  agent,
}: {
  agent: {
    id: string;
    name: string;
    provider: string;
    provider_agent_id: string | null;
    phone_number: string | null;
    voice_desc: string | null;
    languages: string[];
    status: string;
    webhook_token: string | null;
  };
}) {
  const [state, action] = useActionState(updateAgent, initial);

  return (
    <form action={action} className="card card-pad">
      <input type="hidden" name="agentId" value={agent.id} />

      <div className="card-head">
        <div>
          <h3>Voice agent</h3>
          <span className="card-sub">
            Changes here affect a live phone line. Every save is logged.
          </span>
        </div>
        <span className={`badge ${agent.status === "live" ? "ok" : ""}`}>
          {agent.status}
        </span>
      </div>

      <div className="field">
        <label htmlFor="ea-name">Agent name</label>
        <input className="input" id="ea-name" name="name" defaultValue={agent.name} required />
      </div>

      <div className="admin-field-row">
        <div className="field">
          <label htmlFor="ea-provider">Provider</label>
          {/* Built from the capability table, not a hand-written list. The
              hardcoded version silently dropped ElevenLabs, so an ElevenLabs
              agent's own provider was missing from its dropdown — and saving
              the form would have changed the provider out from under it,
              orphaning every call already ingested under the old pair. */}
          <select className="input" id="ea-provider" name="provider" defaultValue={agent.provider}>
            {PROVIDER_ORDER.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_CAPABILITIES[p].label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="ea-phone">Phone number</label>
          <input
            className="input"
            id="ea-phone"
            name="phoneNumber"
            defaultValue={agent.phone_number ?? ""}
            placeholder="+91 79 4000 1234"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="ea-provider-id">Provider agent ID</label>
        <input
          className="input mono"
          id="ea-provider-id"
          name="providerAgentId"
          defaultValue={agent.provider_agent_id ?? ""}
          placeholder="app_id from the provider console"
        />
        <p className="field-hint">
          This maps an incoming call to this agency. Each agent needs its own,
          so two agencies cannot share one.
        </p>
      </div>

      <div className="admin-field-row">
        <div className="field">
          <label htmlFor="ea-voice">Voice</label>
          <input
            className="input"
            id="ea-voice"
            name="voiceDesc"
            defaultValue={agent.voice_desc ?? ""}
            placeholder="Warm female, Indian English"
          />
        </div>

        <div className="field">
          <label htmlFor="ea-langs">Languages</label>
          <input
            className="input"
            id="ea-langs"
            name="languages"
            defaultValue={agent.languages.join(", ")}
            placeholder="English, Hindi"
          />
          <p className="field-hint">Comma separated.</p>
        </div>
      </div>

      {/* Every provider except Retell authenticates on the path token, so the
          warning belongs to all of them — it was Sarvam-only when Sarvam was
          the only one. */}
      {agent.provider !== "retell" && agent.webhook_token && (
        <div className="notice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <p>
            <b>This agent has a webhook token.</b> Its URL is on the Webhooks
            tab. The token is what identifies this agency on the provider&rsquo;s
            calls, so treat that URL like a password.
          </p>
        </div>
      )}

      {state.error && (
        <div className="auth-err show" role="alert">
          {state.error}
        </div>
      )}
      {state.ok && <p className="admin-saved">Saved.</p>}

      <div className="request-actions">
        <Submit />
      </div>
    </form>
  );
}
