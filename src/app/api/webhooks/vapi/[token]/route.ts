import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestCall } from "@/lib/ingest";
import {
  normaliseVapiCall,
  VAPI_FINAL_EVENT,
  type VapiWebhookPayload,
} from "@/lib/providers/vapi";

/**
 * ============================================================================
 * Vapi call ingestion. Spec §4, third provider.
 * ============================================================================
 *
 * AUTHENTICATION IS THE URL, as with Sarvam.
 *
 * Vapi CAN authenticate: it supports an `Authorization: Bearer` header, or the
 * legacy `X-Vapi-Secret`, configured per assistant or per phone number. That is
 * strictly stronger than a token in a path, because a header does not end up in
 * a proxy log or a screenshot.
 *
 * The path token is used anyway, for one reason: it needs no credential setup
 * in Vapi's console, so onboarding an agency is pasting one URL rather than
 * creating a credential and attaching it. Sarvam already established the
 * pattern and `voice_agents.webhook_token` already exists with a default.
 *
 * WORTH REVISITING once Voxline has real clients. Moving to a Bearer header is
 * a small change here (compare the header instead of the path segment) and a
 * per-assistant credential in Vapi. The token would then identify and the
 * header would authenticate, which is what Retell effectively gets for free.
 *
 * ONE URL, MANY EVENTS. Vapi posts status-update, transcript,
 * conversation-update, speech-update, tool-calls and hang to this same route.
 * Only `end-of-call-report` describes a finished call. Everything else is
 * answered 200 and dropped: a 500 makes Vapi retry an event we will never
 * process, forever.
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
  ctx: RouteContext<"/api/webhooks/vapi/[token]">
) {
  const { token } = await ctx.params;

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // Service role, because voice_agents is not readable without a session and
  // there is no session on a webhook.
  const supabase = createAdminClient();
  const { data: agents, error: lookupError } = await supabase
    .from("voice_agents")
    .select("id, provider_agent_id, webhook_token")
    .eq("provider", "vapi")
    .not("webhook_token", "is", null);

  if (lookupError) {
    console.error("[vapi] agent lookup failed", lookupError);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  // Constant-time compare against each candidate rather than querying by the
  // token directly: an indexed equality lookup on a secret can leak timing.
  const agent = (agents ?? []).find(
    (a) => a.webhook_token && tokenMatches(token, a.webhook_token)
  );

  if (!agent) {
    console.warn("[vapi] rejected: unrecognised webhook token");
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let payload: VapiWebhookPayload;
  try {
    payload = (await request.json()) as VapiWebhookPayload;
  } catch {
    // Authentic but unparseable. Retrying will not help, so accept it.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  // The bulk of Vapi's traffic. Cheap to reject, and rejected before the
  // assistant-id check so a mid-call event never trips the mismatch alarm.
  const eventType = payload.message?.type;
  if (eventType !== VAPI_FINAL_EVENT) {
    return NextResponse.json({ ok: true, ignored: `event ${eventType ?? "unknown"}` });
  }

  // The token proves which agent is calling. If the body claims a different
  // assistant, something is wrong — a misconfigured server URL or a forged
  // body — and guessing which would write a call into the wrong tenant.
  const claimed = payload.message?.assistant?.id ?? payload.message?.call?.assistantId;
  if (claimed && claimed !== agent.provider_agent_id) {
    console.error(
      `[vapi] assistant mismatch: token belongs to ${agent.provider_agent_id}, body claims ${claimed}`
    );
    return NextResponse.json({ error: "agent mismatch" }, { status: 401 });
  }

  // Trust the token's agent over the body's assistant id.
  const normalised = normaliseVapiCall({
    ...payload,
    message: {
      ...payload.message,
      assistant: {
        ...(payload.message?.assistant ?? {}),
        id: agent.provider_agent_id ?? claimed,
      },
    },
  });

  if (!normalised) {
    return NextResponse.json({ ok: true, ignored: "missing call id/assistant id" });
  }

  const result = await ingestCall(normalised);

  if (!result.ok) {
    // 500 only for things a retry might fix; 200 for anything permanent, so
    // Vapi does not loop forever on a payload we can never process.
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
