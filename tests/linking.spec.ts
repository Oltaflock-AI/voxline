import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import type {
  SarvamClient,
  SarvamDeployment,
} from "../src/lib/providers/sarvam-client";
import { SarvamClientError } from "../src/lib/providers/sarvam-client";
import {
  describeSetWebhookFailure,
  linkSarvamDeployment,
  redactWebhookToken,
  sarvamWebhookUrl,
  verifySarvamWebhook,
} from "../src/lib/linking";

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

// The database persists between runs, and voice_agents has unique indexes on
// (provider, provider_agent_id) and (provider, provider_deployment_id) plus an
// ownership check — fixed fixture ids would make the previous run's rows fail this one.
const RUN = Date.now().toString(36);

const admin = () =>
  createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

function deployment(over: Partial<SarvamDeployment> = {}): SarvamDeployment {
  return {
    deployment_id: `dep-1-${RUN}`,
    name: "Test Deployment",
    status: "active",
    app_id: `app-1-${RUN}`,
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
      { tenantId, deploymentId: `dep-1-${RUN}`, actorUserId: ADMIN_USER, appUrl: APP_URL },
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
    expect(row?.provider_agent_id).toBe(`app-1-${RUN}`);          // app_id, not deployment_id
    expect(row?.provider_deployment_id).toBe(`dep-1-${RUN}`);
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
      deployment_id: `dep-1-${RUN}`,
      app_id: `app-1-${RUN}`,
      app_version: 3,
    });
    expect(JSON.stringify(audit?.payload)).not.toContain(row!.webhook_token!);
  });

  test("re-linking the same tenant updates the existing row instead of adding one", async () => {
    const tenantId = await throwawayTenant("again");
    const sarvam = fakeSarvam(deployment({ app_id: `app-again-${RUN}`, deployment_id: `dep-again-${RUN}` }));
    const deps = { client: sarvam.client, admin: admin() };
    const input = { tenantId, deploymentId: `dep-again-${RUN}`, actorUserId: ADMIN_USER, appUrl: APP_URL };

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
    const sarvam = fakeSarvam(deployment({ app_id: `app-shared-${RUN}`, deployment_id: `dep-shared-${RUN}` }));
    const deps = { client: sarvam.client, admin: admin() };

    const first = await linkSarvamDeployment(
      { tenantId: a, deploymentId: `dep-shared-${RUN}`, actorUserId: ADMIN_USER, appUrl: APP_URL },
      deps
    );
    const second = await linkSarvamDeployment(
      { tenantId: b, deploymentId: `dep-shared-${RUN}`, actorUserId: ADMIN_USER, appUrl: APP_URL },
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
      deployment({ app_id: `app-unv-${RUN}`, deployment_id: `dep-unv-${RUN}` }),
      { honourWrites: false }
    );

    const result = await linkSarvamDeployment(
      { tenantId, deploymentId: `dep-unv-${RUN}`, actorUserId: ADMIN_USER, appUrl: APP_URL },
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

test.describe("verifySarvamWebhook", () => {
  test("confirms a hand-wired webhook without re-linking", async () => {
    const tenantId = await throwawayTenant("hand");
    const dep = deployment({ app_id: `app-hand-${RUN}`, deployment_id: `dep-hand-${RUN}` });
    const sarvam = fakeSarvam(dep);
    const db = admin();

    const { data: row, error } = await db
      .from("voice_agents")
      .insert({
        tenant_id: tenantId,
        provider: "sarvam",
        provider_agent_id: `app-hand-${RUN}`,
        name: "Hand Wired",
        status: "paused",
      })
      .select("id, webhook_token")
      .single();
    if (error || !row) throw error ?? new Error("no row");

    // Point the fake Sarvam's webhook_url at exactly what this row's token expects.
    await sarvam.client.setWebhook(dep.deployment_id, sarvamWebhookUrl(APP_URL, row.webhook_token!));

    const result = await verifySarvamWebhook(
      { agentId: row.id, actorUserId: ADMIN_USER, appUrl: APP_URL },
      { client: sarvam.client, admin: db }
    );

    expect(result).toEqual({ ok: true, agentId: row.id });

    const { data: after } = await db
      .from("voice_agents")
      .select("provider_deployment_id, linked_at, webhook_verified_at")
      .eq("id", row.id)
      .single();
    expect(after?.provider_deployment_id).toBe(`dep-hand-${RUN}`);
    expect(after?.linked_at).not.toBeNull();
    expect(after?.webhook_verified_at).not.toBeNull();

    const { data: audit } = await db
      .from("audit_log")
      .select("action, payload")
      .eq("tenant_id", tenantId)
      .eq("action", "voice_agent.webhook_verified")
      .single();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.payload)).not.toContain(row.webhook_token!);
  });

  test("refuses when Sarvam's webhook points elsewhere", async () => {
    const tenantId = await throwawayTenant("handbad");
    const dep = deployment({
      app_id: `app-handbad-${RUN}`,
      deployment_id: `dep-handbad-${RUN}`,
      webhook_url: "https://elsewhere.test/hook",
    });
    const sarvam = fakeSarvam(dep, { honourWrites: false });
    const db = admin();

    const { data: row, error } = await db
      .from("voice_agents")
      .insert({
        tenant_id: tenantId,
        provider: "sarvam",
        provider_agent_id: `app-handbad-${RUN}`,
        name: "Hand Wired Bad",
        status: "paused",
      })
      .select("id")
      .single();
    if (error || !row) throw error ?? new Error("no row");

    const result = await verifySarvamWebhook(
      { agentId: row.id, actorUserId: ADMIN_USER, appUrl: APP_URL },
      { client: sarvam.client, admin: db }
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("does not point at Voxline"),
    });

    const { data: after } = await db
      .from("voice_agents")
      .select("linked_at, webhook_verified_at")
      .eq("id", row.id)
      .single();
    expect(after?.linked_at).toBeNull();
    expect(after?.webhook_verified_at).toBeNull();
  });
});

/**
 * The redactor exists so a provider's error body can be logged safely. If it
 * ever stops matching the URL shape, the webhook token starts appearing in
 * production logs and nothing else would notice.
 */
test.describe("redactWebhookToken", () => {
  test("strips the token from a webhook URL but leaves the rest readable", () => {
    const token = "4e271e59f8f14029a16cd3e07ce081fc3908b2fa9cfc431b890cdf2ecdc623b3";
    const body = JSON.stringify({
      detail: [{ msg: "invalid", input: `https://voxline.oltaflock.ai/api/webhooks/sarvam/${token}` }],
    });
    const out = redactWebhookToken(body);
    expect(out).not.toContain(token);
    expect(out).toContain("/api/webhooks/sarvam/<redacted>");
    expect(out).toContain("invalid");
  });

  test("leaves an unrelated long id alone", () => {
    const out = redactWebhookToken('{"deployment_id":"Voxline-Dem-e9d47cba-bfc5"}');
    expect(out).toContain("Voxline-Dem-e9d47cba-bfc5");
  });

  test("caps the length so a huge body cannot flood the log", () => {
    expect(redactWebhookToken("x".repeat(5000)).length).toBe(1200);
  });
});

/**
 * The message a failed link shows. It is the only thing standing between a
 * person and an hour of guessing, which is what the first vague version cost.
 */
test.describe("describeSetWebhookFailure", () => {
  const activeBody = JSON.stringify({
    error: {
      message: "(422) Invalid Parameter",
      code: 422,
      data: { details: "Only paused deployments can be edited. Current status: 'active'." },
    },
  });

  test("names the paused-deployment rule and the action to take", () => {
    const msg = describeSetWebhookFailure(new SarvamClientError(422, activeBody, "https://x"));
    expect(msg).toContain("PAUSED");
    expect(msg).toContain("Pause it in the Sarvam console");
  });

  test("falls back to the generic wording for an unrecognised refusal", () => {
    const other = new SarvamClientError(422, '{"error":{"data":{"details":"something else"}}}', "https://x");
    expect(describeSetWebhookFailure(other)).toContain("Sarvam rejected the webhook update");
  });

  test("survives a non-Sarvam error without throwing", () => {
    expect(describeSetWebhookFailure(new Error("boom"))).toContain("not linked");
  });
});
