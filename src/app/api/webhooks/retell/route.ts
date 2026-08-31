import { NextResponse, type NextRequest } from "next/server";
import { ingestCall } from "@/lib/ingest";
import {
  verifyRetellSignature,
  isIngestableRetellEvent,
  normaliseRetellCall,
  type RetellWebhookEvent,
} from "@/lib/providers/retell";

/**
 * ============================================================================
 * Retell call ingestion — spec §4, "the heart of the product". Ticket S-2.
 * ============================================================================
 *
 * This route does two things and nothing else: prove the request is authentic,
 * and hand a normalised call to ingestCall(). Everything shared with the other
 * provider — tenant resolution, idempotent upsert, field merging, lead
 * creation, minute claiming — lives in lib/ingest.ts so it is written once.
 * See src/app/api/webhooks/sarvam/[token]/route.ts for the second provider.
 *
 * TWO RULES THAT STAY HERE
 *
 * 1. VERIFY THE SIGNATURE FIRST, before parsing or touching the database.
 *    Ingestion runs on the service role and bypasses RLS. This is the one
 *    place where a bug means anyone on the internet can write into any tenant.
 *
 * 2. ONLY 5xx ON SOMETHING A RETRY COULD FIX.
 *    A non-2xx makes Retell retry. For a transient database blip that is what
 *    we want; for a payload we can never process it is an infinite loop. So:
 *    401 for a bad signature, 500 for transient failures, 200 for everything
 *    else — including events we deliberately ignore.
 */

export async function POST(request: NextRequest) {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[retell] RETELL_WEBHOOK_SECRET is not set; refusing.");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // The RAW body, not the parsed object. The signature is over the exact bytes
  // Retell sent; JSON.parse then JSON.stringify reorders keys and changes
  // whitespace, and the HMAC no longer matches.
  const rawBody = await request.text();
  const signature = request.headers.get("x-retell-signature");

  if (!verifyRetellSignature(rawBody, signature, secret)) {
    console.warn("[retell] rejected: bad signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: RetellWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RetellWebhookEvent;
  } catch {
    // Authentic but unparseable. Retrying will not help.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const eventName = event.event ?? "";
  if (!isIngestableRetellEvent(eventName)) {
    return NextResponse.json({ ok: true, ignored: eventName });
  }

  const normalised = normaliseRetellCall(event);
  if (!normalised) {
    return NextResponse.json({ ok: true, ignored: "missing call_id/agent_id" });
  }

  const result = await ingestCall(normalised);

  if (!result.ok) {
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
