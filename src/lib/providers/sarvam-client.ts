/**
 * ============================================================================
 * Sarvam Voice Agents — outbound client.
 * ============================================================================
 *
 * The other half of ./sarvam.ts. That file parses what Sarvam sends us; this
 * one calls Sarvam. Kept separate because the parser is imported by the public
 * webhook route and must stay free of anything that needs credentials.
 *
 * Surface, verified 2026-09-04 against the live API and the OpenAPI spec at
 * docs.sarvam.ai/conversations/openapi/voice-agents.yaml:
 *
 *   GET   /v1/orgs/{org}/workspaces/{ws}/deployments            paginated
 *   GET   /v1/orgs/{org}/workspaces/{ws}/deployments/{id}
 *   PATCH /v1/orgs/{org}/workspaces/{ws}/deployments/{id}       UpdateDeployment
 *
 * Auth is `x-api-key`. `Authorization: Bearer` is rejected, and so is the
 * `sk_` speech key in SARVAM_API_KEY — this API wants the separate,
 * workspace-scoped Voice Agents key in SARVAM_VOICE_API_KEY.
 *
 * Two shapes for one object: the list endpoint returns `phone_numbers: []`,
 * the get endpoint returns `connection_configs: [{agent_phone_number}]`. Both
 * are normalised to `phone_numbers` here so nothing downstream cares.
 *
 * `fetch` is injectable so the client can be tested without the network.
 */

export type SarvamDeployment = {
  deployment_id: string;
  name: string | null;
  status: string | null;
  app_id: string;
  app_version: number;
  phone_numbers: string[];
  channel_direction: string | null;
  webhook_url: string | null;
  updated_at: string;
};

export type SarvamClient = {
  listDeployments(): Promise<SarvamDeployment[]>;
  getDeployment(deploymentId: string): Promise<SarvamDeployment>;
  /** Sets ONLY webhook_config. Returns the deployment as Sarvam reports it after the write. */
  setWebhook(deploymentId: string, url: string): Promise<SarvamDeployment>;
};

export type SarvamClientConfig = {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
};

export class SarvamClientError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, url: string) {
    // The URL is safe to include: deployment endpoints carry no secret. Never
    // add the request body here — setWebhook's body carries the token.
    super(`Sarvam ${status} on ${url}`);
    this.name = "SarvamClientError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE = "https://apps.sarvam.ai/api/app-authoring";
const PAGE = 100; // the documented maximum

// What Sarvam actually sends, loosely typed on purpose: the spec marks most
// fields nullable and the two endpoints disagree on the number field.
type RawDeployment = {
  deployment_id: string;
  name?: string | null;
  status?: string | null;
  app_id: string;
  app_version: number;
  phone_numbers?: string[] | null;
  connection_configs?: { agent_phone_number?: string | null }[] | null;
  channel_direction?: string | null;
  webhook_config?: { url?: string | null } | null;
  updated_at: string;
};

function normalise(raw: RawDeployment): SarvamDeployment {
  const fromConfigs = (raw.connection_configs ?? [])
    .map((c) => c.agent_phone_number)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  return {
    deployment_id: raw.deployment_id,
    name: raw.name ?? null,
    status: raw.status ?? null,
    app_id: raw.app_id,
    app_version: raw.app_version,
    phone_numbers: raw.phone_numbers ?? fromConfigs,
    channel_direction: raw.channel_direction ?? null,
    webhook_url: raw.webhook_config?.url ?? null,
    updated_at: raw.updated_at,
  };
}

export function createSarvamClient(cfg: SarvamClientConfig): SarvamClient {
  const doFetch = cfg.fetch ?? fetch;
  const base =
    `${(cfg.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "")}` +
    `/v1/orgs/${encodeURIComponent(cfg.orgId)}` +
    `/workspaces/${encodeURIComponent(cfg.workspaceId)}/deployments`;

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const url = `${base}${path}`;
    const res = await doFetch(url, {
      method: init.method ?? "GET",
      headers: {
        "x-api-key": cfg.apiKey,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) throw new SarvamClientError(res.status, text, url);
    return JSON.parse(text) as T;
  }

  return {
    async listDeployments() {
      const all: SarvamDeployment[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await request<{ items: RawDeployment[]; total: number }>(
          `?limit=${PAGE}&offset=${offset}`
        );
        all.push(...page.items.map(normalise));
        if (page.items.length < PAGE || all.length >= page.total) break;
      }
      return all;
    },

    async getDeployment(deploymentId) {
      const raw = await request<RawDeployment>(`/${encodeURIComponent(deploymentId)}`);
      return normalise(raw);
    },

    async setWebhook(deploymentId, url) {
      const raw = await request<RawDeployment>(`/${encodeURIComponent(deploymentId)}`, {
        method: "PATCH",
        body: { webhook_config: { url } },
      });
      return normalise(raw);
    },
  };
}

/**
 * The client for the running environment, or null when Sarvam is not
 * configured. Null rather than a throw so a page can render "Sarvam is not
 * connected" instead of a 500.
 */
export function sarvamClientFromEnv(): SarvamClient | null {
  const apiKey = process.env.SARVAM_VOICE_API_KEY;
  const orgId = process.env.SARVAM_ORG_ID;
  const workspaceId = process.env.SARVAM_WORKSPACE_ID;
  if (!apiKey || !orgId || !workspaceId) return null;
  return createSarvamClient({ apiKey, orgId, workspaceId });
}
