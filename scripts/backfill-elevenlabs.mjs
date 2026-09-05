/**
 * Replay conversations ElevenLabs already has into Voxline.
 *
 *   node scripts/backfill-elevenlabs.mjs --agent agent_680… --url https://…/<token>
 *   node scripts/backfill-elevenlabs.mjs --agent agent_680… --url … --commit
 *   node scripts/backfill-elevenlabs.mjs --agent agent_680… --url … --commit --limit 20
 *
 * WHY THIS EXISTS
 *
 * Two reasons, and the second is the one that keeps paying.
 *
 * 1. Rise & Shine and Sarthak Singapore have been running ElevenLabs agents
 *    for months. Those calls carry transcripts, structured extraction and
 *    audio; they were simply made before Voxline could hear about them. A
 *    portal showing an agency two calls when they made two hundred is not a
 *    demo of anything.
 *
 * 2. IT VERIFIES THE ADAPTER AGAINST REAL PAYLOADS. src/lib/providers/
 *    elevenlabs.ts was written from the documentation plus the Sarthak edge
 *    function, never from a delivery Voxline itself received. The report at
 *    the end says which field locations real conversations actually populate —
 *    including how many carry each brief field, which is how you find out that
 *    an agent's data collection is misconfigured before a client does.
 *
 * HOW IT REPLAYS
 *
 * Through the real webhook route, signed exactly as ElevenLabs signs — same
 * `t=<unix>,v0=<hmac>` header over `<t>.<rawBody>`. That is deliberate, and it
 * is the same reasoning as scripts/backfill-vapi.mjs: the webhook is the path
 * a live call takes, so replaying through it exercises token check, signature
 * check, agent-id check and ingest together. Importing ingestCall() would test
 * the adapter and skip everything that has to work in production.
 *
 * The REST detail object IS the webhook's `data` field, so the only
 * transformation is wrapping it in the envelope.
 *
 * IDEMPOTENT. ingestCall() upserts on (provider, provider_call_id), so running
 * this twice does not duplicate anything. Safe to re-run after a failure.
 *
 * TWO WORKSPACES
 *
 * ElevenLabs credentials are workspace-scoped and Voxline's two clients are in
 * different workspaces. Pass --ref to use the suffixed variables:
 *
 *   (default)      ELEVENLABS_API_KEY          ELEVENLABS_WEBHOOK_SECRET
 *   --ref riseshine ELEVENLABS_API_KEY_RISESHINE ELEVENLABS_WEBHOOK_SECRET_RISESHINE
 *
 * The suffix must match the agent's `credential_ref` column, or the recording
 * fetch that ingest triggers will reach for a key that cannot see the agent.
 *
 * CREDENTIALS
 *   put them in voxline/.env.elevenlabs (gitignored by the .env* rule)
 *   the webhook URL is passed with --url and carries its own token — never put
 *   it in the same file as the key
 */
import { createHmac } from "node:crypto";
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

const env = { ...readEnvFile(".env.elevenlabs"), ...process.env };

const REF = arg("ref", "");
const SUFFIX = REF ? `_${REF.toUpperCase()}` : "";
const API_KEY = env[`ELEVENLABS_API_KEY${SUFFIX}`];
const SECRET = env[`ELEVENLABS_WEBHOOK_SECRET${SUFFIX}`];
const AGENT_ID = arg("agent");
const WEBHOOK_URL = arg("url");
const LIMIT = Number(arg("limit", "100"));
const COMMIT = flag("commit");

const missing = [];
if (!API_KEY) missing.push(`ELEVENLABS_API_KEY${SUFFIX}`);
if (!SECRET) missing.push(`ELEVENLABS_WEBHOOK_SECRET${SUFFIX}`);
if (missing.length) {
  console.error(
    `Missing ${missing.join(" and ")}. Put them in voxline/.env.elevenlabs, or export them.`
  );
  process.exit(1);
}
if (!AGENT_ID) {
  console.error("No agent. Pass --agent agent_xxxxxxxx (the ElevenLabs agent id).");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("No webhook URL. Pass --url https://…/api/webhooks/elevenlabs/<token>");
  process.exit(1);
}

const API = "https://api.elevenlabs.io/v1/convai";

async function el(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: { "xi-api-key": API_KEY } });
  if (!res.ok) {
    const body = await res.text();
    // The workspace trap, called out by name: a key from the wrong workspace
    // reports a missing document rather than a bad credential.
    const hint = /not found/i.test(body)
      ? "  (a key from the wrong ElevenLabs workspace reports exactly this — check --ref)"
      : "";
    throw new Error(`ElevenLabs ${res.status} ${pathname}: ${body.slice(0, 200)}${hint}`);
  }
  return res.json();
}

/** Every finished conversation for one agent, following the cursor. */
async function listConversations() {
  const out = [];
  let cursor = "";
  while (out.length < LIMIT) {
    const qs = new URLSearchParams({ agent_id: AGENT_ID, page_size: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await el(`/conversations?${qs}`);
    const batch = page.conversations ?? [];
    out.push(...batch);
    if (!page.has_more || !page.next_cursor || batch.length === 0) break;
    cursor = page.next_cursor;
  }
  return out.slice(0, LIMIT);
}

/**
 * The REST detail object is the webhook's `data` field, so this is the whole
 * transformation. `type` is forced because the detail carries no event type of
 * its own — a finished conversation IS a post_call_transcription.
 */
function asWebhookBody(detail) {
  return {
    type: "post_call_transcription",
    event_timestamp: Math.floor(Date.now() / 1000),
    data: detail,
  };
}

/** Sign exactly as ElevenLabs does, so the route's real check runs. */
function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac("sha256", SECRET).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v0=${v0}`;
}

/** Which fields the agent's data collection actually filled, per call. */
function describeShape(detail) {
  const dcr = detail?.analysis?.data_collection_results ?? {};
  const filled = Object.entries(dcr)
    .filter(([, v]) => {
      const value = v && typeof v === "object" && "value" in v ? v.value : v;
      return value !== null && value !== undefined && value !== "";
    })
    .map(([k]) => k);
  return {
    fields: filled,
    turns: Array.isArray(detail?.transcript) ? detail.transcript.length : 0,
    seconds: detail?.metadata?.call_duration_secs ?? 0,
    hasPhone: Boolean(detail?.metadata?.phone_call),
  };
}

const summaries = await listConversations();
console.log(`${summaries.length} conversations on ${AGENT_ID}\n`);

const fieldCounts = {};
let sent = 0;
let failed = 0;
let skipped = 0;

for (const summary of summaries) {
  const id = summary.conversation_id;
  let detail;
  try {
    detail = await el(`/conversations/${encodeURIComponent(id)}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${id}  detail fetch: ${e.message}`);
    continue;
  }

  const shape = describeShape(detail);
  for (const f of shape.fields) fieldCounts[f] = (fieldCounts[f] ?? 0) + 1;

  const when = summary.start_time_unix_secs
    ? new Date(summary.start_time_unix_secs * 1000).toISOString().slice(0, 16).replace("T", " ")
    : "?";
  const label = `${when}  ${id.slice(0, 12)}  ${String(shape.seconds).padStart(4)}s  ${String(shape.turns).padStart(3)} turns`;

  if (!COMMIT) {
    console.log(`DRY  ${label}  ${shape.fields.join(",") || "(no fields)"}`);
    continue;
  }

  const body = JSON.stringify(asWebhookBody(detail));
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "ElevenLabs-Signature": sign(body) },
    body,
  });
  const out = await res.json().catch(() => ({}));

  if (res.ok && out.call_id) {
    sent += 1;
    console.log(`OK   ${label}${out.lead_created ? "  +lead" : ""}`);
  } else if (res.ok && out.ignored) {
    skipped += 1;
    console.log(`SKIP ${label}  ${out.ignored}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}  ${res.status}  ${JSON.stringify(out).slice(0, 160)}`);
  }
}

console.log("\n--- data collection fields actually populated ---");
const total = summaries.length || 1;
for (const [field, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${field.padEnd(22)} ${String(n).padStart(4)} / ${summaries.length}  (${Math.round((n / total) * 100)}%)`);
}
if (Object.keys(fieldCounts).length === 0) {
  console.log("  none — this agent has no data collection configured, so every");
  console.log("  brief will be empty. Configure it in ElevenLabs -> Analysis.");
}
console.log(
  "\nA field missing here is a field the agent never collects. A field here that\n" +
  "Voxline does not read is a name mismatch — the same bug that once made two\n" +
  "of Rise & Shine's five fields silently dead. Compare against BRIEF_FIELDS\n" +
  "in src/lib/calls.ts."
);

if (COMMIT) {
  console.log(`\n${sent} ingested, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
} else {
  console.log("\nDry run. Re-run with --commit to ingest.");
}
