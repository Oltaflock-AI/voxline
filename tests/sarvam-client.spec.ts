import { test, expect } from "@playwright/test";
import {
  createSarvamClient,
  SarvamClientError,
} from "../src/lib/providers/sarvam-client";

/**
 * The Sarvam client against a fake fetch. No network: what is under test is
 * that we send the right request and read the right fields, both of which were
 * established against the live API on 2026-09-04 and must not drift.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown }
) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const { status, body } = handler(url, init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: f, calls };
}

const CFG = { apiKey: "test-key", orgId: "org-1", workspaceId: "ws-1" };

// The shape Sarvam's list endpoint actually returns (captured live).
const listItem = (n: number, webhook: string | null = null) => ({
  name: `Deployment ${n}`,
  deployment_id: `dep-${n}`,
  status: "active",
  app_id: `app-${n}`,
  app_version: 3,
  phone_numbers: [`+9179000000${n}`],
  channel_direction: "inbound_outbound",
  webhook_config: webhook ? { url: webhook, metadata: null } : null,
  updated_at: "2026-08-31T13:23:39.730639Z",
});

// The GET-one shape carries connection_configs instead of phone_numbers.
const detail = (n: number, webhook: string | null = null) => ({
  ...listItem(n, webhook),
  phone_numbers: undefined,
  connection_configs: [
    { connection_id: "conn-1", agent_phone_number: `+9179000000${n}` },
  ],
});

test.describe("sarvam client", () => {
  test("sends x-api-key, not Bearer", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: { items: [], total: 0, limit: 100, offset: 0 },
    }));
    await createSarvamClient({ ...CFG, fetch }).listDeployments();

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("authorization")).toBeNull();
  });

  test("lists deployments across pages and normalises phone numbers", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const items =
        offset === 0
          ? Array.from({ length: 100 }, (_, i) => listItem(i))
          : [listItem(100, "https://x.test/hook")];
      return { status: 200, body: { items, total: 101, limit: 100, offset } };
    });

    const deployments = await createSarvamClient({ ...CFG, fetch }).listDeployments();

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/v1/orgs/org-1/workspaces/ws-1/deployments?");
    expect(deployments).toHaveLength(101);
    expect(deployments[0]).toEqual({
      deployment_id: "dep-0",
      name: "Deployment 0",
      status: "active",
      app_id: "app-0",
      app_version: 3,
      phone_numbers: ["+91790000000"],
      channel_direction: "inbound_outbound",
      webhook_url: null,
      updated_at: "2026-08-31T13:23:39.730639Z",
    });
    expect(deployments[100].webhook_url).toBe("https://x.test/hook");
  });

  test("getDeployment reads numbers out of connection_configs", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: detail(7) }));
    const d = await createSarvamClient({ ...CFG, fetch }).getDeployment("dep-7");
    expect(d.phone_numbers).toEqual(["+91790000007"]);
    expect(d.webhook_url).toBeNull();
  });

  test("setWebhook PATCHes only webhook_config", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: detail(2, "https://vox.test/api/webhooks/sarvam/tok"),
    }));

    const d = await createSarvamClient({ ...CFG, fetch }).setWebhook(
      "dep-2",
      "https://vox.test/api/webhooks/sarvam/tok"
    );

    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].url).toMatch(/\/deployments\/dep-2$/);
    // Only the webhook. Sending name/app_version/connection_configs too is
    // how a PATCH silently rewrites a live line's numbers.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      webhook_config: { url: "https://vox.test/api/webhooks/sarvam/tok" },
    });
    expect(d.webhook_url).toBe("https://vox.test/api/webhooks/sarvam/tok");
  });

  test("non-2xx becomes a SarvamClientError carrying status and body", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      body: { error: { message: "(401) Unauthorized" } },
    }));
    const err = await createSarvamClient({ ...CFG, fetch })
      .getDeployment("dep-1")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SarvamClientError);
    expect((err as SarvamClientError).status).toBe(401);
    expect((err as SarvamClientError).body).toContain("Unauthorized");
  });
});
