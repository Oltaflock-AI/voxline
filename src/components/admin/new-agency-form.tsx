"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { createAgency, type AdminFormState } from "@/app/admin/actions";

const initial: AdminFormState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create agency"}
    </button>
  );
}

/** Derive a URL name from the agency name, so nobody has to invent one. */
function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function NewAgencyForm({
  plans,
}: {
  plans: { id: string; name: string; included_minutes: number }[];
}) {
  const [state, action] = useActionState(createAgency, initial);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Once the URL name is edited by hand, stop overwriting it from the name.
  const [slugTouched, setSlugTouched] = useState(false);
  const effectiveSlug = slugTouched ? slug : slugify(name);

  if (state.ok) {
    return (
      <div className="card card-pad request-done">
        <span className="ring">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h3>Agency created</h3>
        <p>
          {state.error
            ? state.error
            : "The agency is ready. Its agent starts paused, so resume it once the phone line is connected."}
        </p>
        <div className="request-actions" style={{ justifyContent: "center", marginTop: 18 }}>
          <Link className="btn-ghost sm" href="/admin/agencies">
            All agencies
          </Link>
          {state.id && (
            <Link className="btn sm" href={`/admin/agencies/${state.id}`}>
              Open it
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="agent-request">
      <div className="card card-pad">
        <div className="card-head">
          <div>
            <h3>The agency</h3>
            <span className="card-sub">
              Fields marked <span className="req">*</span> are required.
            </span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ag-name">
            Agency name <span className="req">*</span>
          </label>
          <input
            className="input"
            id="ag-name"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Blue Harbor Travel"
          />
        </div>

        <div className="field">
          <label htmlFor="ag-slug">
            URL name <span className="req">*</span>
          </label>
          <input
            className="input"
            id="ag-slug"
            name="slug"
            required
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.currentTarget.value);
            }}
            placeholder="blueharbor"
          />
          <p className="field-hint">
            Their portal address: <code>/app/{effectiveSlug || "…"}</code>. Lowercase
            letters, numbers and hyphens. This cannot be changed later without
            breaking their bookmarks.
          </p>
        </div>

        <div className="field">
          <label htmlFor="ag-plan">Plan</label>
          <select className="input" id="ag-plan" name="planId" defaultValue="">
            <option value="">No plan yet</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.included_minutes.toLocaleString()} minutes)
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="ag-owner">Owner&rsquo;s email</label>
          <input
            className="input"
            id="ag-owner"
            name="ownerEmail"
            type="email"
            placeholder="sofia@blueharbor.example"
          />
          <p className="field-hint">
            Links an existing Voxline user to this agency as its owner. If they
            have not signed up yet, leave this blank and add them afterwards.
            The agency is created either way.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <div>
            <h3>Their voice agent</h3>
            <span className="card-sub">
              Optional now. You can add it once the agent is built in the
              provider console.
            </span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ag-agent">Agent name</label>
          <input
            className="input"
            id="ag-agent"
            name="agentName"
            placeholder="Blue Harbor Trip Line"
          />
        </div>

        <div className="field">
          <label htmlFor="ag-provider">Provider</label>
          <select className="input" id="ag-provider" name="provider" defaultValue="sarvam">
            <option value="sarvam">Sarvam</option>
            <option value="retell">Retell AI</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="ag-provider-id">Provider agent ID</label>
          <input
            className="input"
            id="ag-provider-id"
            name="providerAgentId"
            placeholder="The app_id from the Sarvam console"
          />
          <p className="field-hint">
            This maps an incoming call to this agency. Get it wrong and their
            calls land in someone else&rsquo;s portal.
          </p>
        </div>

        <div className="field">
          <label htmlFor="ag-phone">Phone number</label>
          <input className="input" id="ag-phone" name="phoneNumber" placeholder="+91 79 4000 1234" />
        </div>
      </div>

      {state.error && (
        <div className="auth-err show" role="alert">
          {state.error}
        </div>
      )}

      <div className="request-actions">
        <Link className="btn-ghost sm" href="/admin/agencies">
          Cancel
        </Link>
        <Submit />
      </div>
    </form>
  );
}
