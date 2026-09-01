"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  submitAgentRequest,
  type AgentRequestState,
  type UploadedFile,
} from "@/app/app/[tenant]/agent/request-actions";
import { DocumentUpload } from "./document-upload";

const initial: AgentRequestState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send request"}
    </button>
  );
}

/** A required field. The asterisk is announced, not just drawn. */
function Req() {
  return (
    <span className="req" aria-hidden="true">
      *
    </span>
  );
}

/**
 * The onboarding intake.
 *
 * Shown instead of the empty state when an agency has no agent yet. Spec §6.6
 * keeps configuration concierge-managed because a bad config breaks a live
 * phone line — this does not change that. It changes how the asking happens:
 * a structured form instead of a WhatsApp thread, so nothing is lost between
 * "we want an agent" and someone building one.
 */
export function AgentRequestForm({
  tenantSlug,
  tenantId,
}: {
  tenantSlug: string;
  tenantId: string;
}) {
  const [state, action] = useActionState(submitAgentRequest, initial);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [purpose, setPurpose] = useState("");
  const formId = useId();

  // Fixed for the life of this form so uploads can be filed under it before
  // the request row exists. useState's initialiser runs once, unlike a bare
  // crypto.randomUUID() call which would change on every render and orphan
  // every file already uploaded.
  const [requestId] = useState(() => crypto.randomUUID());

  if (state.ok) {
    return (
      <div className="card card-pad request-done">
        <span className="ring">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h3>Request received</h3>
        <p>
          We have everything we need to start. Your Voxline contact will be in
          touch, and this page will show your agent once it is live.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="agent-request">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="files" value={JSON.stringify(files)} />

      <div className="card card-pad">
        <div className="card-head">
          <div>
            <h3>Tell us about your agency</h3>
            <span className="card-sub">
              We need the fields marked <span className="req">*</span> to build
              your agent.
            </span>
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-summary`}>
            What does your agency do? <Req />
          </label>
          <textarea
            className="input"
            id={`${formId}-summary`}
            name="agency_summary"
            required
            placeholder="Family holidays and honeymoon packages, mostly domestic plus Southeast Asia."
          />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-top`}>
            What are the three things callers ask for most?
          </label>
          <textarea
            className="input"
            id={`${formId}-top`}
            name="top_requests"
            placeholder="Package prices, availability over Diwali, visa help."
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>What the agent is for</h3>
        </div>

        <fieldset className="field choice-set">
          <legend>
            What should the agent do? <Req />
          </legend>
          {[
            ["consultant", "Answer incoming enquiries and capture trip details"],
            ["outreach", "Call out to leads and follow them up"],
            ["both", "Both"],
          ].map(([value, label]) => (
            <label className="choice" key={value}>
              <input
                type="radio"
                name="purpose"
                value={value}
                required
                onChange={() => setPurpose(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor={`${formId}-direction`}>Call direction</label>
          <select className="input" id={`${formId}-direction`} name="direction" defaultValue="">
            <option value="">Not sure, work it out from the answer above</option>
            <option value="inbound">Inbound only</option>
            <option value="outbound">Outbound only</option>
            <option value="both">Both</option>
          </select>
        </div>

        {(purpose === "outreach" || purpose === "both") && (
          <div className="field">
            <label htmlFor={`${formId}-goal`}>
              When the agent calls someone, what counts as a successful call?
            </label>
            <textarea
              className="input"
              id={`${formId}-goal`}
              name="outreach_goal"
              placeholder="They confirm their travel dates and agree to a quote by email."
            />
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>How it should sound</h3>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-greeting`}>
            The exact greeting it answers with <Req />
          </label>
          <textarea
            className="input"
            id={`${formId}-greeting`}
            name="greeting"
            required
            placeholder="Good morning, thanks for calling Blue Harbor Travel. How can I help you plan your trip?"
          />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-languages`}>
            Which languages should it speak? <Req />
          </label>
          <input
            className="input"
            id={`${formId}-languages`}
            name="languages"
            required
            placeholder="English and Hindi"
          />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-voice`}>Voice</label>
          <select className="input" id={`${formId}-voice`} name="voice" defaultValue="">
            <option value="">No preference, pick one for us</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>What it must find out</h3>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-capture`}>
            What must the agent ask every caller? <Req />
          </label>
          <textarea
            className="input"
            id={`${formId}-capture`}
            name="must_capture"
            required
            placeholder="Destination, travel dates, how many people, rough budget, and the occasion."
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h3>Availability and handover</h3>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-hours`}>
            Opening hours <Req />
          </label>
          <input
            className="input"
            id={`${formId}-hours`}
            name="hours"
            required
            placeholder="Mon to Sat, 10:00 to 19:00 IST"
          />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-after`}>
            What should happen outside those hours? <Req />
          </label>
          <textarea
            className="input"
            id={`${formId}-after`}
            name="after_hours"
            required
            placeholder="Take the enquiry as normal and tell them we will call back the next working morning."
          />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-escalation`}>
            A number to transfer urgent calls to <Req />
          </label>
          <input
            className="input"
            id={`${formId}-escalation`}
            name="escalation_number"
            required
            placeholder="+91 98765 43210"
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <div>
            <h3>Your phone number</h3>
            <span className="card-sub">
              We give you the number for your agent. You do not need to arrange
              anything.
            </span>
          </div>
        </div>

        <p className="field-intro">
          We only ask about the number your customers ring today, so calls do
          not go to a phone nobody answers.
        </p>

        <div className="field">
          <label htmlFor={`${formId}-existing`}>
            What number do customers call you on right now?
          </label>
          <input
            className="input"
            id={`${formId}-existing`}
            name="existing_number"
            placeholder="Leave blank if you do not have one"
          />
        </div>

        <fieldset className="field choice-set">
          <legend>What would you like us to do with it?</legend>
          {[
            [
              "forward",
              "Forward it to the agent. You keep your number, callers notice nothing, and the agent picks up",
            ],
            [
              "new",
              "Nothing for now. We will give you a new number to start advertising",
            ],
            ["advise", "Not sure, tell us what you would recommend"],
          ].map(([value, label]) => (
            <label className="choice" key={value}>
              <input type="radio" name="existing_number_action" value={value} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <div>
            <h3>Anything the agent should know</h3>
            <span className="card-sub">
              Packages, price lists, destination guides or FAQs. The agent uses
              these to answer accurately instead of guessing.
            </span>
          </div>
        </div>

        <DocumentUpload
          tenantId={tenantId}
          requestId={requestId}
          onChange={setFiles}
        />

        <p className="doc-privacy">
          Files stay private to your agency. Only your Voxline contact can open
          them.
        </p>
      </div>

      {state.error && (
        <div className="auth-err show" role="alert">
          {state.error}
        </div>
      )}

      <div className="request-actions">
        <Submit />
      </div>
    </form>
  );
}
