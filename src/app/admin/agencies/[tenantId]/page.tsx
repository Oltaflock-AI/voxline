import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { EditAgentForm } from "@/components/admin/edit-agent-form";
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

  const agent = tenant.voice_agents?.[0] ?? null;

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
        {agent && (
          <form action={setAgentStatus}>
            <input type="hidden" name="agentId" value={agent.id} />
            <input
              type="hidden"
              name="status"
              value={agent.status === "live" ? "paused" : "live"}
            />
            <button className={agent.status === "live" ? "btn-ghost sm" : "btn sm"} type="submit">
              {agent.status === "live" ? "Pause agent" : "Resume agent"}
            </button>
          </form>
        )}
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
          {agent ? (
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
          ) : (
            <div className="card card-pad empty">
              <b>No voice agent yet</b>
              <p>
                This agency has no agent record, so no calls can reach it. Add
                one once it is built in the provider console.
              </p>
            </div>
          )}
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
