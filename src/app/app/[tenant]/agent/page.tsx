import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { requireTenant } from "@/lib/tenant";
import { ChangeRequestModal } from "@/components/change-request-modal";
import { AgentRequestForm } from "@/components/agent/agent-request-form";
import { DocumentUpdateForm } from "@/components/agent/document-update-form";
import { RequestProgress } from "@/components/agent/request-progress";

/**
 * Agent setup — spec §6.6. Read only, deliberately.
 *
 * "Clients do not edit agent config directly in v1, a bad config breaks a live
 * phone line. Keep it concierge and say so in the UI, as the prototype does."
 * That is why there is a notice at the top and a request modal rather than a
 * form: the constraint is a product decision, so the UI states it plainly
 * instead of hiding it behind disabled inputs.
 *
 * The page has three states, not two:
 *   no agent, no request   the onboarding intake form
 *   no agent, request open the progress tracker — concierge onboarding fails
 *                          when it is silent, not when it is manual
 *   agent live             the read-only config, plus document updates
 */
type VoiceAgentRow = Database["public"]["Tables"]["voice_agents"]["Row"];

export default async function AgentPage(
  props: PageProps<"/app/[tenant]/agent">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);

  const supabase = await createClient();
  const [{ data: agentRows }, { data: openRequest }] = await Promise.all([
    // Every agent, oldest first. An agency can run more than one line — Sarthak
    // Singapore has one per property — and `.limit(1)` with no ORDER BY showed
    // an arbitrary one of them while the others were simply invisible.
    supabase
      .from("voice_agents")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("agent_requests")
      .select("id, stage, status_note, created_at")
      .eq("tenant_id", tenant.id)
      .eq("kind", "new_agent")
      .not("stage", "in", '("completed","cancelled")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const agents = agentRows ?? [];

  if (agents.length === 0) {
    // A request already in flight: show where it has got to rather than the
    // form again. Someone who has filled this in wants to know what is
    // happening, not to be asked a second time.
    if (openRequest) {
      return (
        <section className="panel on">
          <RequestProgress
            stage={openRequest.stage}
            statusNote={openRequest.status_note}
            submittedAt={openRequest.created_at}
          />
        </section>
      );
    }

    return (
      <section className="panel on">
        <div className="notice" style={{ marginBottom: 18 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <p>
            <b>Let&rsquo;s set up your voice agent.</b> Tell us how it should
            answer your phone and what it needs to find out. We build it, connect
            a phone number, and let you hear it before it goes live.
          </p>
        </div>

        <AgentRequestForm tenantSlug={tenant.slug} tenantId={tenant.id} />
      </section>
    );
  }

  return (
    <section className="panel on">
      <div className="notice">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
        <p>
          <b>The Voxline team makes your changes.</b> Your agent answers a live
          phone line, so you send us a request instead of editing the settings
          here. We usually make the change the same day.
        </p>
      </div>

      {agents.map((agent) => (
        <AgentConfigCard
          key={agent.id}
          agent={agent}
          tenantSlug={tenant.slug}
          showName={agents.length > 1}
        />
      ))}

      <DocumentUpdateForm tenantSlug={tenant.slug} tenantId={tenant.id} />
    </section>
  );
}

/**
 * One agent's read-only configuration.
 *
 * Split out of the page body so several can render. `showName` puts the agent
 * name in the card heading only when there is more than one to tell apart —
 * an agency with a single line does not need "Larkin Travel Trip Line" written
 * twice on the same screen.
 */
function AgentConfigCard({
  agent,
  tenantSlug,
  showName,
}: {
  agent: VoiceAgentRow;
  tenantSlug: string;
  showName: boolean;
}) {
  const hours = agent.business_hours as {
    days?: string;
    open?: string;
    close?: string;
    tz?: string;
  } | null;
  const crm = agent.crm_connection as {
    provider?: string;
    status?: string;
  } | null;

  const rows: [string, string][] = [
    ["Agent name", agent.name],
    ["Phone number", agent.phone_number ?? "Not assigned"],
    ["Voice", agent.voice_desc ?? "Not set"],
    ["Languages", agent.languages.join(", ") || "Not set"],
    [
      "Business hours",
      hours?.days
        ? `${hours.days}, ${hours.open} to ${hours.close}${hours.tz ? ` ${hours.tz}` : ""}`
        : "Not set",
    ],
    ["After-hours behaviour", agent.after_hours_behavior ?? "Not set"],
    ["Escalation number", agent.escalation_number ?? "Not set"],
    [
      "CRM sync",
      crm?.provider
        ? `${crm.provider[0].toUpperCase()}${crm.provider.slice(1)}, ${crm.status}`
        : "Not connected",
    ],
    [
      "Qualification questions",
      agent.qualification_questions.join(" · ") || "Not set",
    ],
    ["Recording retention", `${agent.recording_retention_months} months`],
  ];

  return (
    <div className="card card-pad">
      <div className="card-head" style={{ alignItems: "center" }}>
        <h3>{showName ? agent.name : "Agent configuration"}</h3>
        <ChangeRequestModal tenantSlug={tenantSlug} />
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
