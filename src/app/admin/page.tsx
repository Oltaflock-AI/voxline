import { requirePlatformAdmin } from "@/lib/admin";
import { logout } from "@/app/login/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { setAgentStatus, resolveChangeRequest } from "./actions";

export const metadata = { title: "Admin · Voxline" };

/**
 * Internal admin console — spec §6.7. "Plain and functional is fine."
 *
 * Everything here runs on the service role and therefore sees ALL tenants,
 * which is the entire point of the console and also why `requirePlatformAdmin`
 * is the first line of the component. Nothing below is protected by RLS.
 *
 * Deliberately not built (spec §9 cut list, and onboarding is a SQL snippet
 * for the first agencies): creating tenants from a form, and "view as tenant"
 * impersonation.
 */
export default async function AdminPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  // Rendered rather than hardcoded so the URLs are correct in every
  // environment — localhost, a Vercel preview, or production.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const [{ data: tenants }, { data: requests }] = await Promise.all([
    admin
      .from("tenants")
      .select(
        `id, name, slug, status, created_at,
         plans ( name ),
         voice_agents ( id, name, status, phone_number, provider, provider_agent_id, webhook_token )`
      )
      .order("created_at", { ascending: true }),
    admin
      .from("change_requests")
      .select("id, message, status, created_at, tenants ( name, slug )")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="content" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h3 className="panel-title">Voxline admin</h3>
          {/*
            Was "All tenants. Service role — RLS does not apply on this page."
            Three pieces of implementation vocabulary that tell the reader
            nothing they can act on. What actually matters to someone standing
            on this page is that it is not scoped to one agency and that the
            buttons touch live customers.
          */}
          <span className="card-sub">
            Every agency on Voxline. Changes here affect live customer accounts.
          </span>
        </div>
        {/*
          Sign out, not "back to portal". A platform admin is Oltaflock staff,
          not an agency user: they have no membership, so /app can only tell
          them "no agency yet". There is no portal of theirs to go back to, and
          a button that leads to a dead end reads as broken.
        */}
        <form action={logout}>
          <button className="btn-ghost sm" type="submit">
            Sign out
          </button>
        </form>
      </div>

      {/* ---------- change request queue ---------- */}
      <div className="card card-pad">
        <div className="card-head">
          <h3>Change requests</h3>
          <span className="card-sub">{requests?.length ?? 0} open</span>
        </div>

        {requests && requests.length > 0 ? (
          requests.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
                padding: "14px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{r.tenants?.name ?? "—"}</b>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-2)",
                    marginTop: 4,
                    lineHeight: 1.55,
                  }}
                >
                  {r.message}
                </p>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "var(--faint)" }}
                >
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
          ))
        ) : (
          <div className="empty">
            <b>Queue is clear</b>
            <p>No open change requests from any agency.</p>
          </div>
        )}
      </div>


      {/* ---------- webhook wiring ---------- */}
      <div className="card card-pad">
        <div className="card-head">
          <h3>Webhook endpoints</h3>
          <span className="card-sub">Paste into the provider console</span>
        </div>

        <div className="notice" style={{ marginBottom: 16 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <p>
            <b>Sarvam URLs contain a secret.</b> Sarvam does not sign its
            webhooks, so the token in the path is what authenticates the
            request. Treat these like passwords — do not paste them into
            tickets or screenshots.
          </p>
        </div>

        {(tenants ?? []).map((t) => {
          const agent = t.voice_agents?.[0];
          if (!agent) return null;
          const url =
            agent.provider === "sarvam"
              ? `${appUrl}/api/webhooks/sarvam/${agent.webhook_token}`
              : `${appUrl}/api/webhooks/retell`;
          return (
            <div
              key={t.id}
              style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}
            >
              <b style={{ fontSize: 13 }}>{t.name}</b>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--faint)", marginLeft: 8 }}
              >
                {agent.provider}
              </span>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  marginTop: 5,
                  wordBreak: "break-all",
                }}
              >
                {url}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- tenants ---------- */}
      <div className="card card-pad">
        <div className="card-head">
          <h3>Agencies</h3>
          <span className="card-sub">{tenants?.length ?? 0} total</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Agency</th>
              <th>Plan</th>
              <th>Provider</th>
              <th>Agent</th>
              <th>Number</th>
              <th className="r">Agent status</th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => {
              const agent = t.voice_agents?.[0];
              return (
                <tr key={t.id}>
                  <td>
                    <b>{t.name}</b>
                    <br />
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--faint)" }}
                    >
                      /{t.slug}
                    </span>
                  </td>
                  <td>{t.plans?.name ?? "—"}</td>
                  <td>
                    {agent ? (
                      <span className={`badge ${agent.provider === "sarvam" ? "acc" : ""}`}>
                        {agent.provider}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {agent?.name ?? "Not configured"}
                    {agent?.provider_agent_id && (
                      <>
                        <br />
                        <span
                          className="mono"
                          style={{ fontSize: 10.5, color: "var(--faint)" }}
                        >
                          {agent.provider_agent_id}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {agent?.phone_number ?? "—"}
                  </td>
                  <td className="r">
                    {agent ? (
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
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
