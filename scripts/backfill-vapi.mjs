/**
 * Backfill calls that Vapi already has into Voxline.
 *
 *   node scripts/backfill-vapi.mjs                 # dry run, prints what it would do
 *   node scripts/backfill-vapi.mjs --commit        # actually POST them
 *   node scripts/backfill-vapi.mjs --commit --limit 20
 *
 * WHY THIS EXISTS
 *
 * Two reasons, and the second is the important one.
 *
 * 1. A demo portal with no calls in it demonstrates nothing. Every call ever
 *    made against the Vapi assistant already carries a transcript, a recording
 *    and eight structured outputs; they were simply made before the webhook
 *    was wired up. This walks Vapi's call list and replays each one.
 *
 * 2. IT VERIFIES THE ADAPTER AGAINST REAL PAYLOADS. src/lib/providers/vapi.ts
 *    was written from Vapi's docs and a dashboard reading, never from a live
 *    delivery, so it reads several fields from two possible locations
 *    (`artifact.recordingUrl` OR `artifact.recording.url`, and so on). Running
 *    real calls through it says which branch actually fires, and the report at
 *    the end prints exactly that. Once it is known, narrow the adapter and
 *    delete the fallbacks: a fallback that never fires is a lie about what the
 *    provider sends.
 *
 * HOW IT REPLAYS
 *
 * It posts each call to the real webhook route rather than importing
 * ingestCall() directly. That is deliberate. The webhook is the path a live
 * call takes — token check, event-type filter, assistant-id check, ingest — so
 * replaying through it exercises the thing that has to work in production. An
 * import would test the adapter and skip the route.
 *
 * Vapi's REST shape is `{ ...call }` while the webhook expects
 * `{ message: { type, ...call } }`, so `asWebhookBody()` wraps it. The wrap is
 * the only difference between a replayed call and a live one.
 *
 * IDEMPOTENT. ingestCall() upserts on (provider, provider_call_id), so running
 * this twice does not duplicate anything. Safe to re-run after a failure.
 *
 * CREDENTIALS
 *   VAPI_API_KEY   in voxline/.env.vapi  (private key, Vapi -> Org -> API keys)
 *   the webhook URL is passed with --url, and carries its own token
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

/** Read a KEY=value file without pulling in a dotenv dependency. */
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of readFileSync(path.resolve(file), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* absent is fine; the caller reports what is missing */
  }
  return out;
}

const env = { ...readEnvFile(".env.vapi"), ...process.env };
const API_KEY = env.VAPI_API_KEY;
const WEBHOOK_URL = arg("url", env.VAPI_WEBHOOK_URL);
const LIMIT = Number(arg("limit", "50"));
const COMMIT = flag("commit");

if (!API_KEY) {
  console.error("VAPI_API_KEY missing. Put it in voxline/.env.vapi");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("No webhook URL. Pass --url https://…/api/webhooks/vapi/<token>");
  process.exit(1);
}

/**
 * Vapi's REST call object into the webhook envelope.
 *
 * `type` is forced to end-of-call-report because that is what a finished call
 * IS; the REST object has no `type` field of its own, and the route drops
 * anything else. Only calls that actually ended are passed in.
 */
function asWebhookBody(call) {
  return {
    message: {
      type: "end-of-call-report",
      endedReason: call.endedReason,
      durationSeconds:
        call.startedAt && call.endedAt
          ? (Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000
          : undefined,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      call: { id: call.id, assistantId: call.assistantId, customer: call.customer ?? null },
      assistant: { id: call.assistantId },
      customer: call.customer ?? null,
      artifact: call.artifact ?? null,
      analysis: call.analysis ?? null,
    },
  };
}

/** Which of the adapter's fallback branches this payload actually needs. */
function describeShape(call) {
  const a = call.artifact ?? {};
  return {
    recording:
      a.recordingUrl ? "artifact.recordingUrl"
      : a.recording?.url ? "artifact.recording.url"
      : a.recording?.stereoUrl ? "artifact.recording.stereoUrl"
      : "none",
    outputs:
      a.structuredOutputs && Object.keys(a.structuredOutputs).length
        ? "artifact.structuredOutputs"
        : call.analysis?.structuredData
          ? "analysis.structuredData"
          : "none",
    messages: Array.isArray(a.messages) ? `${a.messages.length} messages` : "none",
    hasDuration: Boolean(call.startedAt && call.endedAt),
  };
}

const res = await fetch(`https://api.vapi.ai/call?limit=${LIMIT}`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});
if (!res.ok) {
  console.error(`Vapi API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const all = await res.json();
// Only finished calls. An in-progress one has no artifact worth replaying and
// its own end-of-call report will arrive over the webhook anyway.
const calls = (Array.isArray(all) ? all : []).filter((c) => c.endedAt);

console.log(`${calls.length} ended calls of ${Array.isArray(all) ? all.length : 0} returned\n`);

const shapes = { recording: {}, outputs: {}, noDuration: 0 };
let sent = 0;
let failed = 0;

for (const call of calls) {
  const shape = describeShape(call);
  shapes.recording[shape.recording] = (shapes.recording[shape.recording] ?? 0) + 1;
  shapes.outputs[shape.outputs] = (shapes.outputs[shape.outputs] ?? 0) + 1;
  if (!shape.hasDuration) shapes.noDuration += 1;

  const when = call.startedAt ? call.startedAt.slice(0, 16).replace("T", " ") : "?";
  const label = `${when}  ${call.id.slice(0, 8)}  ${String(call.type ?? "?").padEnd(8)}`;

  if (!COMMIT) {
    console.log(`DRY  ${label}  rec=${shape.recording}  out=${shape.outputs}  ${shape.messages}`);
    continue;
  }

  const post = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(asWebhookBody(call)),
  });
  const body = await post.json().catch(() => ({}));

  if (post.ok && body.ok && body.call_id) {
    sent += 1;
    console.log(`OK   ${label}  -> ${body.call_id}${body.lead_created ? "  +lead" : ""}`);
  } else if (post.ok && body.ignored) {
    console.log(`SKIP ${label}  ${body.ignored}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}  ${post.status}  ${JSON.stringify(body).slice(0, 160)}`);
  }
}

console.log("\n--- payload shapes actually seen ---");
console.log("recording url at:", shapes.recording);
console.log("structured data at:", shapes.outputs);
if (shapes.noDuration) console.log(`calls with no start/end pair: ${shapes.noDuration}`);
console.log(
  "\nUse this to narrow src/lib/providers/vapi.ts: any branch showing 0 here is a fallback that never fires."
);

if (COMMIT) {
  console.log(`\n${sent} ingested, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
} else {
  console.log("\nDry run. Re-run with --commit to ingest.");
}
