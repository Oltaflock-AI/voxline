import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestCall } from "@/lib/ingest";
import {
  normaliseSarvamCall,
  type SarvamWebhookPayload,
} from "@/lib/providers/sarvam";

/**
 * ============================================================================
 * Sarvam Voice Agents call ingestion. Spec §4, adapted to a second provider.
 * ============================================================================
 *
 * AUTHENTICATION IS THE URL, because Sarvam gives us nothing else.
 *
 * Retell signs every webhook with HMAC-SHA256 and we verify it. Sarvam
 * documents no signature, no secret header and no bearer token — checked
 * across the campaigns and instant-outbound payload docs on 2026-08-29. The
 * body itself carries nothing an attacker could not invent.
 *
 * So the webhook URL carries a 256-bit per-agent token:
 *   https://<host>/api/webhooks/sarvam/<webhook_token>
 * and the token identifies AND authenticates the agent in one step.
 *
 * What this buys, and what it does not:
 *   + Unguessable, so the endpoint is not open to the internet.
 *   + Per-agent and rotatable, so one leak is not a platform-wide breach.
 *   − Cannot detect a tampered body the way a signature can.
 *   − Leaks if the URL is ever logged, screenshotted or pasted in a ticket.
 *
 * That is the strongest verification an unsigned provider allows. Spec §8
 * requires webhook verification and never-cuts it; this satisfies the intent.
 * If Sarvam ships signing, switch to it and drop the token.
 *
 * The token is compared in constant time — a plain === leaks how much of the
 * prefix was right, and enough samples recover it a byte at a time.
 */

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/webhooks/sarvam/[token]">
) {
  const { token } = await ctx.params;

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // Look the agent up by token first. Service role, because voice_agents is
  // not readable without a session and there is no session here.
  const supabase = createAdminClient();
  const { data: agents, error: lookupError } = await supabase
    .from("voice_agents")
    .select("id, provider_agent_id, webhook_token")
    .eq("provider", "sarvam")
    .not("webhook_token", "is", null);

  if (lookupError) {
    console.error("[sarvam] agent lookup failed", lookupError);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  // Constant-time compare against each candidate rather than querying by the
  // token directly: an indexed equality lookup on a secret can leak timing.
  const agent = (agents ?? []).find(
    (a) => a.webhook_token && tokenMatches(token, a.webhook_token)
  );

  if (!agent) {
    console.warn("[sarvam] rejected: unrecognised webhook token");
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let payload: SarvamWebhookPayload;
  try {
    payload = (await request.json()) as SarvamWebhookPayload;
  } catch {
    // Authentic but unparseable. Retrying will not help, so accept it.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  // KEY NAMES ONLY, never values. Sarvam delivers at least three post-call
  // shapes to this one route and they disagree about which field holds the
  // duration, the id and the variables. On 2026-09-05 an inbound
  // `webhook_config` delivery was mistaken for a call that never connected,
  // and the trip brief was discarded, because it used `duration` where the
  // adapter expected `call_length_seconds`. There was no way to see that from
  // the outside; a call arrived and was quietly wrong.
  //
  // Keys are safe to log and answer the question immediately. Values are not:
  // this payload carries the caller's phone number, their name and the whole
  // transcript.
  console.log(
    `[sarvam] payload keys: ${Object.keys(payload ?? {}).sort().join(",")}`
  );

  // The token proves which agent is calling. If the body claims a different
  // app_id, something is wrong — either a misconfigured webhook URL or a
  // forged body — and guessing which would mean writing a call into the wrong
  // tenant's portal.
  if (payload.app_id && payload.app_id !== agent.provider_agent_id) {
    console.error(
      `[sarvam] app_id mismatch: token belongs to ${agent.provider_agent_id}, body claims ${payload.app_id}`
    );
    return NextResponse.json({ error: "agent mismatch" }, { status: 401 });
  }

  // Trust the token's agent over the body's app_id.
  const normalised = normaliseSarvamCall({
    ...payload,
    app_id: agent.provider_agent_id ?? payload.app_id,
  });

  if (!normalised) {
    return NextResponse.json({
      ok: true,
      ignored: "missing attempt_id/interaction_id/app_id",
    });
  }

  const result = await ingestCall(normalised);

  if (!result.ok) {
    // 500 only for things a retry might fix; 200 for anything permanent, so
    // the provider does not loop forever on a payload we can never process.
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
