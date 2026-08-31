/**
 * Fire a signed, fake Retell webhook at the local dev server.
 *
 * Until a real phone number is attached, this is how the ingestion path gets
 * exercised. It is also how you check idempotency: run it twice and confirm
 * you get one call row and one lead, not two.
 *
 *   node scripts/send-test-webhook.mjs                  # a qualifying call
 *   node scripts/send-test-webhook.mjs --outcome voicemail
 *   node scripts/send-test-webhook.mjs --bad-signature  # must be rejected 401
 *   node scripts/send-test-webhook.mjs --event call_analyzed
 */
import crypto from "node:crypto";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const outcome = flag("outcome", "inquiry_captured");
const event = flag("event", "call_ended");
const callId = flag("call-id", "test_call_local_001");
const badSignature = args.includes("--bad-signature");

const payload = {
  event,
  call: {
    call_id: callId,
    // Matches voice_agents.provider_agent_id for Wanderlux, the seed's Retell
    // agency. Blue Harbor moved to Sarvam when providers were generalised, and
    // this line kept pointing at it — every run returned "unknown agent" and
    // still exited 200, so the script looked like it was working.
    agent_id: "agent_seed_wanderlux",
    from_number: "+1 (305) 555-0999",
    to_number: "+1 (305) 555-0122",
    start_timestamp: Date.now() - 5 * 60_000,
    end_timestamp: Date.now(),
    duration_ms: 272_000,
    recording_url: "https://example.invalid/recording.wav",
    transcript_object: [
      {
        role: "agent",
        content: "Thanks for calling Blue Harbor Travel. Where are you dreaming of going?",
        words: [{ start: 0 }],
      },
      {
        role: "user",
        content: "We were thinking Iceland, maybe February, two of us.",
        words: [{ start: 6 }],
      },
      {
        role: "agent",
        content: "Lovely. What budget range should we plan around?",
        words: [{ start: 14 }],
      },
      {
        role: "user",
        content: "Somewhere around seven thousand dollars all in.",
        words: [{ start: 20 }],
      },
    ],
    call_analysis: {
      call_summary: "Caller wants northern lights, flexible on exact dates.",
      custom_analysis_data: {
        caller_name: "Test Caller",
        outcome,
        destination: "Iceland",
        dates: "February",
        party_size: "2 travellers",
        budget: "~$7,000",
        occasion: "Northern lights",
        notes: "Flexible on exact dates. Wants a glass igloo if possible.",
      },
    },
  },
};

const body = JSON.stringify(payload);
const signature = badSignature
  ? "0".repeat(64)
  : crypto
      .createHmac("sha256", env.RETELL_WEBHOOK_SECRET)
      .update(body, "utf8")
      .digest("hex");

const res = await fetch("http://localhost:3000/api/webhooks/retell", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-retell-signature": signature,
  },
  body,
});

console.log(`${event} / ${outcome}${badSignature ? " / BAD SIGNATURE" : ""}`);
console.log(`HTTP ${res.status}`, await res.text());
