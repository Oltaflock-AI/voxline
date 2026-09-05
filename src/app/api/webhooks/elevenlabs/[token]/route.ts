import crypto from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestCall } from "@/lib/ingest";
import { elevenLabsWebhookSecret } from "@/lib/providers/elevenlabs-credentials";
import {
  normaliseElevenLabsCall,
  ELEVENLABS_FINAL_EVENT,
  ELEVENLABS_FAILURE_EVENT,
  type ElevenLabsWebhookPayload,
} from "@/lib/providers/elevenlabs";

/**
 * ============================================================================
 * ElevenLabs call ingestion. Spec §4, fourth provider.
 * ============================================================================
 *
 * TWO CREDENTIALS, NOT ONE, AND THAT SHAPES THE ORDER OF THIS HANDLER.
 *
 * Retell's route says, correctly, "verify the signature FIRST, before parsing
 * or touching the database". This one cannot: ElevenLabs webhook secrets are
 * per WORKSPACE, Rise & Shine's agent and Sarthak Singapore's three are in
 * different workspaces, and the only thing identifying which is the token in
 * the path. So the order here is:
 *
 *   1. path token  ->  which agent, and therefore which workspace
 *   2. that workspace's secret  ->  verify the HMAC
 *   3. only then, ingest
 *
 * Nothing is written before the signature passes. The lookup in step 1 is an
 * indexed, bounded, read-only SELECT. If you are reading this because the
 * ordering looks wrong against the Retell route: it is deliberate, and
 * "verify first" is impossible without knowing whose secret to verify against.
 *
 * SIGNATURE FORMAT. `ElevenLabs-Signature: t=<unix>,v0=<hex>`, where the signed
 * string is `<t>.<rawBody>`, HMAC-SHA256 with the webhook's secret. The public
 * documentation does not publish the construction; this is taken from the
 * Sarthak Singapore edge function, which has been verifying these deliveries
 * in production since July 2026 (Oltaflock-AI/sarthak-singapore,
 * supabase/functions/elevenlabs-webhook/index.ts).
 *
 * The timestamp is checked as well as the digest. Without a window, a captured
 * delivery replays forever — the HMAC stays valid because the body never
 * changes.
 *
 * A MISSING SECRET IS A 500, NOT A PASS. Failing open would make an
 * unconfigured deployment accept anything at all.
 *
 * FORWARDING. An ElevenLabs agent has exactly ONE post-call webhook, so
 * pointing it at Voxline takes it away from wherever it pointed before — for
 * Rise & Shine, their own dashboard. When `webhook_forward_url` is set we
 * re-POST the delivery there, byte for byte with the original signature
 * header, so their HMAC still verifies and nothing on their side changes.
 * VOXLINE IS THEREFORE LOAD-BEARING FOR ANOTHER SYSTEM whenever that column is
 * populated. It is empty by default.
 */

const SIGNATURE_TOLERANCE_SECS = 30 * 60;

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length first: timingSafeEqual throws on a mismatch rather than returning.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verify `t=…,v0=…` over `<t>.<rawBody>`, within the replay window. */
function signatureValid(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSecs: number
): boolean {
  if (!header) return false;

  let t = "";
  let v0 = "";
  for (const part of header.split(",")) {
    const [k, value] = part.split("=");
    if (k?.trim() === "t") t = value?.trim() ?? "";
    else if (k?.trim() === "v0") v0 = value?.trim() ?? "";
  }
  if (!t || !v0) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSecs - ts) > SIGNATURE_TOLERANCE_SECS) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(v0, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/webhooks/elevenlabs/[token]">
) {
  const { token } = await ctx.params;

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // Service role: voice_agents is not readable without a session, and a
  // webhook has none.
  const supabase = createAdminClient();
  const { data: agents, error: lookupError } = await supabase
    .from("voice_agents")
    .select("id, provider_agent_id, webhook_token, credential_ref, webhook_forward_url")
    .eq("provider", "elevenlabs")
    .not("webhook_token", "is", null);

  if (lookupError) {
    console.error("[elevenlabs] agent lookup failed", lookupError);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  // Constant-time compare against each candidate rather than querying by the
  // token directly: an indexed equality lookup on a secret can leak timing.
  const agent = (agents ?? []).find(
    (a) => a.webhook_token && tokenMatches(token, a.webhook_token)
  );

  if (!agent) {
    console.warn("[elevenlabs] rejected: unrecognised webhook token");
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const secret = elevenLabsWebhookSecret(agent.credential_ref);
  if (!secret) {
    console.error(
      `[elevenlabs] no webhook secret configured for credential_ref ${JSON.stringify(agent.credential_ref ?? null)}`
    );
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // The RAW body, before any parse. JSON.parse then JSON.stringify reorders
  // keys and the digest no longer matches — the same trap Retell's route
  // documents.
  const rawBody = await request.text();
  const nowSecs = Math.floor(Date.now() / 1000);

  if (
    !signatureValid(
      rawBody,
      request.headers.get("elevenlabs-signature"),
      secret,
      nowSecs
    )
  ) {
    console.warn("[elevenlabs] rejected: signature mismatch or expired");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // --- forward, before we decide whether WE care about this event ----------
  // Voxline ingests one event type. Whoever used to receive this webhook may
  // consume others — `post_call_audio` in particular — so forwarding after the
  // event filter would silently break their product in a way neither side
  // would diagnose quickly.
  //
  // `after()` so the forward never sits on our response path: awaiting a slow
  // endpoint would push ElevenLabs into a timeout and a retry, which re-ingests
  // (idempotent) and re-forwards (almost certainly not).
  if (agent.webhook_forward_url) {
    const url = agent.webhook_forward_url;
    const signature = request.headers.get("elevenlabs-signature") ?? "";
    after(async () => {
      let status = 0;
      try {
        // Exactly two headers. Never our own token, never cookies, never an
        // Authorization header — this is a URL from the database and it must
        // not become a way to make Voxline hand its credentials to a stranger.
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ElevenLabs-Signature": signature,
          },
          body: rawBody,
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
      } catch (err) {
        console.error("[elevenlabs] forward threw", err);
        status = 0;
      }
      // Recorded rather than only logged: a forward that quietly stopped
      // working would otherwise be discovered by the client noticing.
      await createAdminClient()
        .from("voice_agents")
        .update({
          webhook_forward_last_status: status,
          webhook_forward_last_at: new Date().toISOString(),
        })
        .eq("id", agent.id);
    });
  }

  let payload: ElevenLabsWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ElevenLabsWebhookPayload;
  } catch {
    // Authentic but unparseable. A retry will not help, so accept it.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const eventType = payload.type;
  if (
    eventType !== ELEVENLABS_FINAL_EVENT &&
    eventType !== ELEVENLABS_FAILURE_EVENT
  ) {
    // `post_call_audio` lands here, deliberately: audio is fetched from the
    // conversation endpoint instead. See lib/recordings.ts for why.
    return NextResponse.json({ ok: true, ignored: `event ${eventType ?? "unknown"}` });
  }

  // The token proves which agent is calling. A body claiming a different agent
  // means a misconfigured webhook or a forged payload, and guessing which
  // would write a call into the wrong tenant.
  const claimed = payload.data?.agent_id;
  if (claimed && claimed !== agent.provider_agent_id) {
    console.error(
      `[elevenlabs] agent mismatch: token belongs to ${agent.provider_agent_id}, body claims ${claimed}`
    );
    return NextResponse.json({ error: "agent mismatch" }, { status: 401 });
  }

  const normalised = normaliseElevenLabsCall({
    ...payload,
    data: {
      ...(payload.data ?? {}),
      // Trust the token's agent over the body's.
      agent_id: agent.provider_agent_id ?? claimed,
    },
  });

  if (!normalised) {
    return NextResponse.json({ ok: true, ignored: "missing conversation/agent id" });
  }

  const result = await ingestCall(normalised);

  if (!result.ok) {
    // 500 only for what a retry could fix; 200 for anything permanent, so
    // ElevenLabs does not loop forever on a payload we can never process.
    return NextResponse.json(
      { ok: result.status === 200, reason: result.reason },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    call_id: result.callId,
    lead_created: result.leadCreated,
  });
}
