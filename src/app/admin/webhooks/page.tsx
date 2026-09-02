import { createAdminClient } from "@/lib/supabase/admin";
import { CopyField } from "@/components/admin/copy-field";
import { getAppUrl } from "@/lib/app-url";

/**
 * The URLs to paste into each provider console.
 *
 * Rendered rather than hardcoded so they are correct in every environment —
 * localhost, a Vercel preview, production. The Sarvam ones contain a secret,
 * which is why they are on their own page behind a warning rather than sitting
 * in the middle of the agency list where a screen-share would catch them.
 */
export default async function AdminWebhooksPage() {
  const admin = createAdminClient();
  const appUrl = getAppUrl();

  const { data: agents } = await admin
    .from("voice_agents")
    .select("id, name, provider, provider_agent_id, webhook_token, tenants ( name, slug )")
    .order("created_at", { ascending: true });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Webhooks</h1>
          <p>Where each provider should send finished calls.</p>
        </div>
      </div>

      <div className="notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
        <p>
          <b>Sarvam URLs contain a secret.</b> Sarvam does not sign its webhooks,
          so the token in the path is the only thing proving a request really
          came from them. Treat these like passwords. Do not paste them into
          tickets, and do not leave this page open on a shared screen.
        </p>
      </div>

      <div className="card card-pad">
        {(agents ?? []).map((a) => {
          const url =
            a.provider === "sarvam"
              ? a.webhook_token
                ? `${appUrl}/api/webhooks/sarvam/${a.webhook_token}`
                : null
              : `${appUrl}/api/webhooks/retell`;

          return (
            <div className="admin-webhook" key={a.id}>
              <div className="admin-webhook-head">
                <b>{a.tenants?.name ?? "Unknown agency"}</b>
                <span className={`badge ${a.provider === "sarvam" ? "acc" : ""}`}>
                  {a.provider}
                </span>
                <span className="admin-muted">{a.name}</span>
              </div>
              {url ? (
                <CopyField value={url} label={`Webhook URL for ${a.tenants?.name ?? "agency"}`} />
              ) : (
                <p className="admin-warn-text">
                  No webhook token on this agent, so Sarvam has nowhere to send
                  its calls. Re-save the agent to generate one.
                </p>
              )}
            </div>
          );
        })}

        {(agents?.length ?? 0) === 0 && (
          <div className="empty">
            <b>No agents yet</b>
            <p>Webhook URLs appear once an agency has a voice agent.</p>
          </div>
        )}
      </div>
    </>
  );
}
