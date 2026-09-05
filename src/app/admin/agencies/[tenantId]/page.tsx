import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { EditAgentForm } from "@/components/admin/edit-agent-form";
import { ConnectAgent } from "@/components/admin/connect-agent";
import { VerifyWebhookButton } from "@/components/admin/verify-webhook-button";
import { setAgentStatus } from "../../actions";

/** Everything about one agency, and the controls that change it. */
export default async function AdminAgencyPage(
  props: PageProps<"/admin/agencies/[tenantId]">
) {
  const { tenantId } = await props.params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select(
      `id, name, slug, status, created_at,
       plans ( id, name, included_minutes ),
       voice_agents ( * ),
       memberships ( user_id, role )`
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) notFound();

  // Every agent, sorted, because the embed comes back unordered and an agency
  // can have several — Sarthak Singapore runs one per property. Taking [0] hid
  // the rest completely: they received calls, appeared on the Webhooks page,
  // and were invisible here.
  const agents = [...(tenant.voice_agents ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const [{ count: callCount }, { count: leadCount }, { data: usage }, { data: requests }] =
    await Promise.all([
      admin.from("calls").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      admin.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      admin
        .from("usage_periods")
        .select("minutes_used, period_end")
        .eq("tenant_id", tenant.id)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("agent_requests")
        .select("id, kind, stage, created_at")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  // Resolve member emails through the auth admin API — `auth.users` is not
  // exposed to PostgREST, so it cannot be joined in the query above.
  const { data: userList } = await admin.auth.admin.listUsers();
  const members = (tenant.memberships ?? []).map((m) => ({
    role: m.role,
    email:
      userList?.users.find((u) => u.id === m.user_id)?.email ?? "unknown user",
  }));

  const facts = [
    { label: "Calls handled", value: (callCount ?? 0).toLocaleString() },
    { label: "Leads", value: (leadCount ?? 0).toLocaleString() },
    {
      label: "Minutes this period",
      value: Math.round(Number(usage?.minutes_used ?? 0)).toLocaleString(),
    },
    { label: "Plan", value: tenant.plans?.name ?? "None" },
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <Link className="admin-back" href="/admin/agencies">
            ← Agencies
          </Link>
          <h1>{tenant.name}</h1>
          <p>
            <span className="mono">/{tenant.slug}</span> · created{" "}
            {new Date(tenant.created_at).toLocaleDateString()}
          </p>
        </div>
        {agents.length === 1 && <AgentStatusButton agent={agents[0]} />}
      </div>

      <div className="admin-stats">
        {facts.map((f) => (
          <div className="card admin-stat" key={f.label}>
            <span className="lab">{f.label}</span>
            <strong className="num">{f.value}</strong>
          </div>
        ))}
      </div>

      <div className="admin-cols">
        <div>
          {agents.map((agent) => (
            <div key={agent.id}>
              {agents.length > 1 && (
                <div className="card-head" style={{ alignItems: "center" }}>
                  <h3>{agent.name}</h3>
                  <AgentStatusButton agent={agent} />
                </div>
              )}
              <LinkStatus agent={agent} />
              <EditAgentForm
                agent={{
                  id: agent.id,
                  name: agent.name,
                  provider: agent.provider,
                  provider_agent_id: agent.provider_agent_id,
                  phone_number: agent.phone_number,
                  voice_desc: agent.voice_desc,
                  languages: agent.languages ?? [],
                  status: agent.status,
                  webhook_token: agent.webhook_token,
                }}
              />
            </div>
          ))}

          {/* Always rendered, not only when the agency has no agent. Adding a
              second line is a normal thing to want — a developer gets an agent
              per project — and the old `agent ? … : Connect` made that
              impossible from the console once the first one existed. */}
          <ConnectAgent tenantId={tenant.id} />
        </div>

        <aside className="admin-side">
          <section className="card card-pad">
            <div className="card-head">
              <h3>Who can sign in</h3>
              <span className="card-sub">{members.length}</span>
            </div>
            {members.length > 0 ? (
              <ul className="admin-members">
                {members.map((m) => (
                  <li key={m.email}>
                    <span>{m.email}</span>
                    <span className="badge">{m.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">
                Nobody is linked to this agency, so no one can open its portal.
              </p>
            )}
          </section>

          <section className="card card-pad">
            <div className="card-head">
              <h3>Recent requests</h3>
              <Link className="admin-link" href="/admin">
                Queue
              </Link>
            </div>
            {requests && requests.length > 0 ? (
              <ul className="admin-members">
                {requests.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.kind === "new_agent" ? "New agent" : "Documents"}
                      <span className="admin-muted">
                        {" "}
                        · {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="badge">{r.stage.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">No requests from this agency yet.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

/**
 * Whether this agent is actually reachable by Voxline, as distinct from
 * described in it. Reads the three linking columns and says so plainly — the
 * whole point of them is that "no calls" stops being the only symptom.
 */
/**
 * Pause or resume one agent.
 *
 * Extracted from the page header so it can render per agent. A Sarvam agent
 * with no verified webhook cannot go live — the button is disabled with the
 * reason in its title rather than hidden, so the path forward stays visible.
 */
function AgentStatusButton({
  agent,
}: {
  agent: {
    id: string;
    provider: string;
    status: string;
    webhook_verified_at: string | null;
  };
}) {
  const canGoLive = !(agent.provider === "sarvam" && !agent.webhook_verified_at);
  const disabled = agent.status !== "live" && !canGoLive;
  return (
    <form action={setAgentStatus}>
      <input type="hidden" name="agentId" value={agent.id} />
      <input
        type="hidden"
        name="status"
        value={agent.status === "live" ? "paused" : "live"}
      />
      <button
        className={agent.status === "live" ? "btn-ghost sm" : "btn sm"}
        type="submit"
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? "Verify the Sarvam webhook first" : undefined}
      >
        {agent.status === "live" ? "Pause agent" : "Resume agent"}
      </button>
    </form>
  );
}

function LinkStatus({
  agent,
}: {
  agent: {
    id: string;
    provider: string;
    provider_deployment_id: string | null;
    linked_at: string | null;
    webhook_verified_at: string | null;
    last_synced_at: string | null;
  };
}) {
  const verified = Boolean(agent.webhook_verified_at);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <section className="card card-pad">
      <div className="card-head">
        <div>
          <h3>{verified ? "Webhook verified" : "Webhook not verified"}</h3>
          <span className="card-sub">
            {verified
              ? `${agent.provider} confirmed it will post finished calls to Voxline.`
              : agent.provider === "sarvam"
                ? "Sarvam has not confirmed a webhook for this agent, so calls will not reach the portal and it cannot go live. Connect its deployment below, or if the URL from the Webhooks tab is already set in Sarvam, verify it."
                : "This agent was wired before verification existed. Check its URL on the Webhooks tab."}
          </span>
        </div>
        <span className={`badge ${verified ? "ok" : "acc"}`}>
          {verified ? "linked" : "unlinked"}
        </span>
      </div>
      {!verified && agent.provider === "sarvam" && (
        <VerifyWebhookButton agentId={agent.id} />
      )}
      <ul className="admin-members">
        {agent.provider_deployment_id && (
          <li>
            <span>Deployment</span>
            <span className="mono">{agent.provider_deployment_id}</span>
          </li>
        )}
        <li>
          <span>Linked</span>
          <span>{fmt(agent.linked_at)}</span>
        </li>
        <li>
          <span>Webhook verified</span>
          <span>{fmt(agent.webhook_verified_at)}</span>
        </li>
        <li>
          <span>Last synced</span>
          <span>{fmt(agent.last_synced_at)}</span>
        </li>
      </ul>
    </section>
  );
}
