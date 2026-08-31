/**
 * Fire a fake Sarvam post-call webhook at the local dev server.
 *
 * Payload shape is taken verbatim from
 * docs.sarvam.ai/conversations/api/campaigns/webhook-payload (read 2026-08-29),
 * so this exercises the same fields a real call will send.
 *
 *   node scripts/send-sarvam-webhook.mjs
 *   node scripts/send-sarvam-webhook.mjs --outcome quote_requested
 *   node scripts/send-sarvam-webhook.mjs --not-connected     # unanswered call
 *   node scripts/send-sarvam-webhook.mjs --bad-token         # must 401
 *
 * Run it twice with the same --attempt-id to confirm idempotency: one call
 * row, one lead, minutes counted once.
 */
// No .env read here, unlike the Retell script: Sarvam does not sign its
// webhooks, so there is no secret to load. The URL token IS the credential.

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

// Matches the seeded Blue Harbor agent, which runs on Sarvam.
const TOKEN = "devtokenblueharbor00000000000000000000000000000000000000000000000";
const token = args.includes("--bad-token") ? "0".repeat(64) : flag("token", TOKEN);

const attemptId = flag("attempt-id", "sarvam_test_attempt_001");
const outcome = flag("outcome", "inquiry_captured");
const connected = !args.includes("--not-connected");

const payload = {
  app_id: "agent_seed_blueharbor",
  app_version: 1,
  attempt_id: attemptId,
  campaign_id: null,
  cohort_id: null,
  completion_status: connected ? "completed" : "failed",
  connectivity_status: connected ? "connected" : "failed",
  next_action_status: null,
  failure_reason: connected ? null : "TelephonyProvider: No Answer",
  user_identifier: "caller-001",
  user_phone_number: "+919876543210",
  agent_phone_number: "+918040000000",
  duration: connected ? 254.5 : null,
  interaction_id: connected ? "20260829/abc123-10:30:00-def456" : null,
  retry_attempt: 0,
  executed_at: new Date().toISOString(),
  initial_agent_variables: { user_name: "Manan" },
  final_agent_variables: connected
    ? {
        caller_name: "Ananya Iyer",
        outcome,
        destination: "Kerala backwaters",
        dates: "Late November",
        party_size: "4 travellers",
        budget: "~₹1,80,000",
        occasion: "Family holiday",
        notes: "Prefers houseboat over resort. Two children under 10.",
      }
    : null,
  // role + en_text only — Sarvam sends no per-turn timestamps.
  interaction_transcript: connected
    ? [
        { role: "agent", en_text: "Thanks for calling Blue Harbor Travel. Where are you dreaming of going?" },
        { role: "user", en_text: "We were thinking Kerala, the backwaters, sometime in November." },
        { role: "agent", en_text: "Lovely choice. How many of you will be travelling?" },
        { role: "user", en_text: "Four of us, two adults and two kids." },
        { role: "agent", en_text: "And what budget should we plan around?" },
        { role: "user", en_text: "Around one point eight lakhs, all in." },
      ]
    : null,
  metadata: { source: "local-test-script" },
};

// --base lets this hit a tunnel or a deployment, not just localhost, which is
// how you prove the URL you are about to paste into Sarvam actually reaches
// the route. Pair it with --bad-token to check reachability without writing
// anything: a 401 from us means the whole path works.
const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const url = `${base}/api/webhooks/sarvam/${token}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

console.log(
  `sarvam ${connected ? "connected" : "NOT connected"} / ${outcome}` +
    `${args.includes("--bad-token") ? " / BAD TOKEN" : ""} / attempt=${attemptId}`
);
console.log(`HTTP ${res.status}`, await res.text());
