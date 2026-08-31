import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { ChangeRequestModal } from "@/components/change-request-modal";

/**
 * Agent setup — spec §6.6. Read only, deliberately.
 *
 * "Clients do not edit agent config directly in v1, a bad config breaks a live
 * phone line. Keep it concierge and say so in the UI, as the prototype does."
 * That is why there is a notice at the top and a request modal rather than a
 * form: the constraint is a product decision, so the UI states it plainly
 * instead of hiding it behind disabled inputs.
 */
export default async function AgentPage(
  props: PageProps<"/app/[tenant]/agent">
) {
  const { tenant: slug } = await props.params;
  const { tenant } = await requireTenant(slug);

  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("voice_agents")
    .select("*")
    .eq("tenant_id", tenant.id)
    .limit(1)
    .maybeSingle();

  if (!agent) {
    return (
      <section className="panel on">
        <div className="empty">
          <b>No agent configured yet</b>
          <p>
            Your Voxline contact wires the voice agent to your phone line during
            onboarding. It will appear here once it is live.
          </p>
        </div>
      </section>
    );
  }

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
    ["Voice", agent.voice_desc ?? "—"],
    ["Languages", agent.languages.join(", ") || "—"],
    [
      "Business hours",
      hours?.days
        ? `${hours.days}, ${hours.open} – ${hours.close}${hours.tz ? ` ${hours.tz}` : ""}`
        : "—",
    ],
    ["After-hours behaviour", agent.after_hours_behavior ?? "—"],
    ["Escalation number", agent.escalation_number ?? "—"],
    [
      "CRM sync",
      crm?.provider
        ? `${crm.provider[0].toUpperCase()}${crm.provider.slice(1)}, ${crm.status}`
        : "Not connected",
    ],
    ["Qualification questions", agent.qualification_questions.join(" · ") || "—"],
    ["Recording retention", `${agent.recording_retention_months} months`],
  ];

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
          <b>Configuration is concierge-managed.</b> Your agent answers a live
          phone line, so changes are made by the Voxline team rather than edited
          directly. Send a request and we usually ship it the same day.
        </p>
      </div>

      <div className="card card-pad">
        <div className="card-head" style={{ alignItems: "center" }}>
          <h3>Agent configuration</h3>
          <ChangeRequestModal tenantSlug={tenant.slug} />
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
    </section>
  );
}
