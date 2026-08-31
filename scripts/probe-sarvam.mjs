/**
 * Answer the three open Sarvam questions against the real API, in one run.
 *
 * Every one of them is blocked on credentials we do not have in the repo, and
 * each is load-bearing for Voxline, so this exists to make answering them a
 * two-minute job rather than an afternoon.
 *
 *   1. What does the recordings endpoint actually return? (docs say `{}`)
 *   2. Does an INBOUND call fire the post-call webhook at all?
 *   3. Is `en_text` a translation or the original, for a non-English call?
 *
 * Usage — credentials come from the environment, never from argv, so they do
 * not end up in shell history:
 *
 *   export SARVAM_API_KEY=...
 *   export SARVAM_ORG_ID=...
 *   export SARVAM_WORKSPACE_ID=...
 *   node scripts/probe-sarvam.mjs --app-id <agent app_id> --interaction-id <id>
 *
 * Get an interaction id from Sarvam's console: Agent analytics → open a call.
 * Use one from a REAL INBOUND call if you have placed one, because that
 * doubles as evidence for question 2.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const KEY = process.env.SARVAM_API_KEY;
const ORG = process.env.SARVAM_ORG_ID;
const WORKSPACE = process.env.SARVAM_WORKSPACE_ID;
const appId = flag("app-id");
const interactionId = flag("interaction-id");

const missing = [
  !KEY && "SARVAM_API_KEY",
  !ORG && "SARVAM_ORG_ID",
  !WORKSPACE && "SARVAM_WORKSPACE_ID",
  !appId && "--app-id",
  !interactionId && "--interaction-id",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}\n`);
  console.error("Org and workspace ids are in the console URL when you are");
  console.error("inside a workspace. app_id is the agent id Voxline stores as");
  console.error("voice_agents.provider_agent_id.");
  process.exit(1);
}

const url =
  `https://apps.sarvam.ai/api/analytics/v1/${encodeURIComponent(ORG)}` +
  `/${encodeURIComponent(WORKSPACE)}/${encodeURIComponent(appId)}` +
  `/recordings/${encodeURIComponent(interactionId)}`;

// Print the endpoint with the key redacted, so the output is safe to paste
// into a ticket for Sarvam support.
console.log(`GET ${url}`);
console.log(`X-API-Key: ${"*".repeat(8)} (${KEY.length} chars)\n`);

const res = await fetch(url, { headers: { "X-API-Key": KEY } });
const contentType = res.headers.get("content-type") ?? "(none)";
const contentLength = res.headers.get("content-length") ?? "(none)";

console.log(`HTTP ${res.status} ${res.statusText}`);
console.log(`content-type:   ${contentType}`);
console.log(`content-length: ${contentLength}\n`);

if (!res.ok) {
  console.log("Body:", (await res.text()).slice(0, 600));
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());

// Sniff the real format rather than trusting the header — an endpoint this
// under-documented may well mislabel what it sends.
const head = buf.subarray(0, 16);
const magic =
  head.subarray(0, 4).toString("ascii") === "RIFF"
    ? "WAV (RIFF)"
    : head.subarray(0, 3).toString("ascii") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      ? "MP3"
      : head.subarray(4, 8).toString("ascii") === "ftyp"
        ? "MP4/M4A"
        : head.subarray(0, 4).toString("ascii") === "OggS"
          ? "OGG"
          : null;

if (magic) {
  console.log(`VERDICT: raw audio — ${magic}, ${buf.length} bytes.`);
  console.log("lib/recordings.ts already handles this path (audio/* branch).");
  console.log("Check the content-type above matches audio/*; if it does not,");
  console.log("widen the branch in fetchSarvamRecording to sniff the magic.");
  process.exit(0);
}

const text = buf.toString("utf8");
let json = null;
try {
  json = JSON.parse(text);
} catch {
  /* not JSON */
}

if (json && typeof json === "object") {
  console.log("VERDICT: JSON.");
  console.log("Top-level keys:", Object.keys(json));
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));

  const known = ["url", "recording_url", "signed_url", "download_url", "audio_url", "recording"];
  const hit = known.find((k) => typeof json[k] === "string" && json[k].startsWith("http"));
  console.log(
    hit
      ? `\nCarries a URL under "${hit}" — lib/recordings.ts handles this already.`
      : `\nNo recognised url key. Add the right one to JSON_URL_KEYS in lib/recordings.ts.`
  );
  if (Object.keys(json).length === 0) {
    console.log("Empty object — same as the docs. Recording probably not ready");
    console.log("yet, or not retained for this interaction. Retry on a fresh call.");
  }
  process.exit(0);
}

console.log("VERDICT: neither audio nor JSON.");
console.log("First 300 bytes as text:", JSON.stringify(text.slice(0, 300)));
console.log("First 16 bytes as hex:  ", head.toString("hex"));
