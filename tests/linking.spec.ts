import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import type {
  SarvamClient,
  SarvamDeployment,
} from "../src/lib/providers/sarvam-client";
import { SarvamClientError } from "../src/lib/providers/sarvam-client";
import { linkSarvamDeployment, sarvamWebhookUrl } from "../src/lib/linking";

/**
 * The wiring step, against a fake Sarvam and the real local database.
 *
 * The database is real because the interesting failures are constraint
 * failures — the same app_id linked to two tenants — and a fake Supabase would
 * have to re-implement the unique index to catch them. Sarvam is fake because
 * every test would otherwise rewrite a live deployment's webhook.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = "https://vox.test";
const ADMIN_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd"; // admin@voxline.test in seed.sql

const admin = () =>
  createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

function deployment(over: Partial<SarvamDeployment> = {}): SarvamDeployment {
  return {
    deployment_id: "dep-1",
    name: "Test Deployment",
    status: "active",
    app_id: "app-1",
    app_version: 3,
    phone_numbers: ["+917900000001"],
    channel_direction: "inbound_outbound",
    webhook_url: null,
    updated_at: "2026-08-31T13:23:39Z",
    ...over,
  };
}

/** A Sarvam that stores the webhook it is given, like the real one does. */
function fakeSarvam(initial: SarvamDeployment, opts: { honourWrites?: boolean } = {}) {
  let state = { ...initial };
  const writes: string[] = [];
  const client: SarvamClient = {
    async listDeployments() {
      return [state];
    },
    async getDeployment(id) {
      if (id !== state.deployment_id) {
        throw new SarvamClientError(404, '{"detail":"Not Found"}', id);
      }
      return { ...state };
    },
    async setWebhook(id, url) {
      writes.push(url);
      if (opts.honourWrites !== false) state = { ...state, webhook_url: url };
      return { ...state };
    },
  };
  return { client, writes, current: () => state };
}

async function throwawayTenant(suffix: string) {
  const slug = `link-${suffix}-${Date.now().toString(36)}`;
  const { data, error } = await admin()
    .from("tenants")
    .insert({ name: `Link ${suffix}`, slug, initials: "LK" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no tenant");
  return data.id;
}

test.describe("linkSarvamDeployment", () => {
  test("creates the agent row, sets the webhook, verifies it, and audits without the token", async () => {
    const tenantId = await throwawayTenant("ok");
    const sarvam = fakeSarvam(deployment());

    const result = await linkSarvamDeployment(
      { tenantId, deploymentId: "dep-1", actorUserId: ADMIN_USER, appUrl: APP_URL },
      { client: sarvam.client, admin: admin() }
    );

    expect(result).toEqual({ ok: true, agentId: expect.any(String) });
    if (!result.ok) return;

    const { data: row } = await admin()
      .from("voice_agents")
      .select("*")
      .eq("id", result.agentId)
      .single();

    expect(row?.tenant_id).toBe(tenantId);
    expect(row?.provider).toBe("sarvam");
    expect(row?.provider_agent_id).toBe("app-1");          // app_id, not deployment_id
    expect(row?.provider_deployment_id).toBe("dep-1");
    expect(row?.phone_number).toBe("+917900000001");
    expect(row?.name).toBe("Test Deployment");
    expect(row?.status).toBe("paused");                    // admin resumes explicitly
    expect(row?.linked_at).not.toBeNull();
    expect(row?.webhook_verified_at).not.toBeNull();
    expect(row?.last_synced_at).not.toBeNull();

    // Sarvam was told the URL built from THIS row's token.
    expect(row?.webhook_token).toMatch(/^[0-9a-f]{64}$/);
    expect(sarvam.writes).toEqual([sarvamWebhookUrl(APP_URL, row!.webhook_token!)]);

    // The audit row records the link but never the secret.
    const { data: audit } = await admin()
      .from("audit_log")
      .select("action, payload")
      .eq("tenant_id", tenantId)
      .eq("action", "voice_agent.linked")
      .single();
    expect(audit?.payload).toMatchObject({
      deployment_id: "dep-1",
      app_id: "app-1",
      app_version: 3,
    });
    expect(JSON.stringify(audit?.payload)).not.toContain(row!.webhook_token!);
  });

  test("re-linking the same tenant updates the existing row instead of adding one", async () => {
    const tenantId = await throwawayTenant("again");
    const sarvam = fakeSarvam(deployment({ app_id: "app-again", deployment_id: "dep-again" }));
    const deps = { client: sarvam.client, admin: admin() };
    const input = { tenantId, deploymentId: "dep-again", actorUserId: ADMIN_USER, appUrl: APP_URL };

    const first = await linkSarvamDeployment(input, deps);
    const second = await linkSarvamDeployment(input, deps);

    expect(first.ok && second.ok && first.agentId === second.agentId).toBe(true);
    const { count } = await admin()
      .from("voice_agents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    expect(count).toBe(1);
  });

  test("refuses to link an app_id another agency already owns", async () => {
    const a = await throwawayTenant("owner");
    const b = await throwawayTenant("thief");
    const sarvam = fakeSarvam(deployment({ app_id: "app-shared", deployment_id: "dep-shared" }));
    const deps = { client: sarvam.client, admin: admin() };

    const first = await linkSarvamDeployment(
      { tenantId: a, deploymentId: "dep-shared", actorUserId: ADMIN_USER, appUrl: APP_URL },
      deps
    );
    const second = await linkSarvamDeployment(
      { tenantId: b, deploymentId: "dep-shared", actorUserId: ADMIN_USER, appUrl: APP_URL },
      deps
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      error: expect.stringContaining("already linked to another agency"),
    });
    // Only one write to Sarvam: the second attempt must bail BEFORE touching it.
    expect(sarvam.writes).toHaveLength(1);
  });

  test("does not mark verified when Sarvam reports a different URL after the write", async () => {
    const tenantId = await throwawayTenant("unverified");
    const sarvam = fakeSarvam(
      deployment({ app_id: "app-unv", deployment_id: "dep-unv" }),
      { honourWrites: false }
    );

    const result = await linkSarvamDeployment(
      { tenantId, deploymentId: "dep-unv", actorUserId: ADMIN_USER, appUrl: APP_URL },
      { client: sarvam.client, admin: admin() }
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("did not confirm the webhook"),
    });

    // The row exists (so the admin can see what happened) but is not verified.
    const { data: row } = await admin()
      .from("voice_agents")
      .select("linked_at, webhook_verified_at, last_synced_at")
      .eq("tenant_id", tenantId)
      .single();
    expect(row?.linked_at).toBeNull();
    expect(row?.webhook_verified_at).toBeNull();
    expect(row?.last_synced_at).toBeNull();
  });

  test("an unknown deployment is a clean error, not a throw", async () => {
    const tenantId = await throwawayTenant("missing");
    const sarvam = fakeSarvam(deployment());

    const result = await linkSarvamDeployment(
      { tenantId, deploymentId: "dep-nope", actorUserId: ADMIN_USER, appUrl: APP_URL },
      { client: sarvam.client, admin: admin() }
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
    });
  });
});
