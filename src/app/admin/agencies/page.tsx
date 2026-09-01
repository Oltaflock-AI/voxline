import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { setAgentStatus } from "../actions";

/**
 * Every agency on the platform.
 *
 * Search is server-side even though the list is short today: it will not stay
 * short, and a filter written in the browser is one that quietly stops working
 * at PostgREST's 1000-row cap — the same failure the Calls tab already had.
 */
export default async function AdminAgenciesPage(
  props: PageProps<"/admin/agencies">
) {
  const { q } = await props.searchParams;
  const search = typeof q === "string" ? q.trim().slice(0, 80) : "";

  const admin = createAdminClient();
  let query = admin
    .from("tenants")
    .select(
      `id, name, slug, status, created_at,
       plans ( name ),
       voice_agents ( id, name, status, phone_number, provider, provider_agent_id ),
       memberships ( user_id )`
    )
    .order("created_at", { ascending: true });

  if (search) {
    const safe = search.replace(/[%_]/g, (c) => `\\${c}`).replace(/[(),*"\\]/g, " ");
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }

  const { data: tenants } = await query;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Agencies</h1>
          <p>{tenants?.length ?? 0} on the platform</p>
        </div>
        <Link className="btn sm" href="/admin/agencies/new">
          New agency
        </Link>
      </div>

      <form className="admin-search" method="get">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          name="q"
          defaultValue={search}
          placeholder="Search by agency name or URL name…"
          aria-label="Search agencies"
        />
        {search && (
          <Link className="btn-ghost sm" href="/admin/agencies">
            Clear
          </Link>
        )}
      </form>

      <div className="card card-pad">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Agency</th>
              <th>Plan</th>
              <th>Agent</th>
              <th>Number</th>
              <th>Users</th>
              <th className="r">Status</th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => {
              const agent = t.voice_agents?.[0];
              return (
                <tr key={t.id}>
                  <td data-label="Agency">
                    <Link className="admin-link" href={`/admin/agencies/${t.id}`}>
                      {t.name}
                    </Link>
                    <br />
                    <span className="mono admin-muted">/{t.slug}</span>
                  </td>
                  <td data-label="Plan">{t.plans?.name ?? "No plan"}</td>
                  <td data-label="Agent">
                    {agent ? (
                      <>
                        {agent.name}
                        <br />
                        <span className={`badge ${agent.provider === "sarvam" ? "acc" : ""}`}>
                          {agent.provider}
                        </span>
                      </>
                    ) : (
                      <span className="admin-muted">No agent yet</span>
                    )}
                  </td>
                  <td className="mono" data-label="Number">{agent?.phone_number ?? "Not set"}</td>
                  <td data-label="Users">
                    {t.memberships?.length ?? 0}
                    {(t.memberships?.length ?? 0) === 0 && (
                      <span className="admin-warn" title="Nobody can sign in to this agency">
                        {" "}
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="r" data-label="Status">
                    {agent ? (
                      <span className={`badge ${agent.status === "live" ? "ok" : ""}`}>
                        {agent.status}
                      </span>
                    ) : (
                      "No agent"
                    )}
                  </td>
                  <td className="r">
                    {agent && (
                      <form action={setAgentStatus}>
                        <input type="hidden" name="agentId" value={agent.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={agent.status === "live" ? "paused" : "live"}
                        />
                        <button className="btn-ghost sm" type="submit">
                          {agent.status === "live" ? "Pause" : "Resume"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {(tenants?.length ?? 0) === 0 && (
          <div className="empty">
            <b>{search ? "No agencies match" : "No agencies yet"}</b>
            <p>
              {search
                ? "Try a different name, or clear the search."
                : "Create the first one to get started."}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
