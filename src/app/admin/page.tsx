import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChangeRequest } from "./actions";
import { RequestCard } from "@/components/admin/request-card";

/**
 * The queue — what needs doing, across every agency.
 *
 * Deliberately the landing page rather than the agency list. Someone opening
 * this console is nearly always here to act on something a client asked for,
 * not to browse; a list of agencies makes them go looking for the work.
 */
export default async function AdminQueuePage() {
  const admin = createAdminClient();

  const [
    { data: agentRequests },
    { data: changeRequests },
    { count: agencyCount },
    { count: liveAgents },
    { count: callCount },
  ] = await Promise.all([
    admin
      .from("agent_requests")
      .select(
        "id, kind, stage, payload, note, status_note, created_at, tenants ( name, slug ), agent_request_files ( id, filename, size_bytes, mime_type, storage_path )"
      )
      .not("stage", "in", '("completed","cancelled")')
      .order("created_at", { ascending: true }),
    admin
      .from("change_requests")
      .select("id, message, created_at, tenants ( name, slug )")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    admin.from("tenants").select("id", { count: "exact", head: true }),
    admin
      .from("voice_agents")
      .select("id", { count: "exact", head: true })
      .eq("status", "live"),
    admin.from("calls").select("id", { count: "exact", head: true }),
  ]);

  const openWork = (agentRequests?.length ?? 0) + (changeRequests?.length ?? 0);

  const stats = [
    { label: "Agencies", value: agencyCount ?? 0 },
    { label: "Agents live", value: liveAgents ?? 0 },
    { label: "Calls handled", value: callCount ?? 0 },
    { label: "Open items", value: openWork },
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Queue</h1>
          <p>
            {openWork === 0
              ? "Nothing waiting. Every request has been dealt with."
              : `${openWork} ${openWork === 1 ? "item needs" : "items need"} attention.`}
          </p>
        </div>
        <Link className="btn sm" href="/admin/agencies/new">
          New agency
        </Link>
      </div>

      <div className="admin-stats">
        {stats.map((s) => (
          <div className="card admin-stat" key={s.label}>
            <span className="lab">{s.label}</span>
            <strong className="num">{s.value.toLocaleString()}</strong>
          </div>
        ))}
      </div>

      <section className="admin-section" aria-labelledby="onboarding-title">
        <div className="admin-section-head">
          <h2 id="onboarding-title">Agent requests</h2>
          <span className="card-sub">
            {agentRequests?.length ?? 0} open · what agencies asked us to build
          </span>
        </div>

        {agentRequests && agentRequests.length > 0 ? (
          <div className="admin-request-list">
            {agentRequests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        ) : (
          <div className="card card-pad empty">
            <b>No open agent requests</b>
            <p>
              New agencies land here when they fill in the form on their Agent
              Setup page.
            </p>
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="changes-title">
        <div className="admin-section-head">
          <h2 id="changes-title">Change requests</h2>
          <span className="card-sub">
            {changeRequests?.length ?? 0} open · tweaks to agents already live
          </span>
        </div>

        {changeRequests && changeRequests.length > 0 ? (
          <div className="card card-pad">
            {changeRequests.map((r) => (
              <div key={r.id} className="admin-change-row">
                <div>
                  <Link
                    className="admin-change-tenant"
                    href={`/admin/agencies?q=${encodeURIComponent(r.tenants?.slug ?? "")}`}
                  >
                    {r.tenants?.name ?? "Unknown agency"}
                  </Link>
                  <p>{r.message}</p>
                  <span className="mono admin-when">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                <form action={resolveChangeRequest}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn-ghost sm" type="submit">
                    Mark done
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <div className="card card-pad empty">
            <b>Queue is clear</b>
            <p>No open change requests from any agency.</p>
          </div>
        )}
      </section>
    </>
  );
}
