import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { elevenLabsApiKey } from "@/lib/providers/elevenlabs-credentials";

type VoiceProvider = Database["public"]["Enums"]["voice_provider"];

/**
 * ============================================================================
 * Fetching a call recording from the provider and putting it in our bucket.
 * ============================================================================
 *
 * Spec §8: "Recordings live in a private bucket, served through short-lived
 * signed URLs." That only works if the audio is actually IN the bucket.
 *
 * Before this existed, ingestion set `calls.recording_path` whenever a payload
 * looked like it had audio, but nothing ever downloaded it — so the portal
 * offered a play control for an object that was never written, and asking for
 * a signed URL returned "Object not found". Verified against a real webhook
 * delivery on 2026-08-29 before writing this.
 *
 * The path convention is deliberately in one place. The storage policy in
 * 20260828120200_storage.sql authorises on the FIRST PATH SEGMENT being a
 * tenant the reader belongs to, so a path built any other way is either
 * unreadable or, worse, readable by the wrong agency.
 */

/** Where the audio can be obtained, as reported by a provider adapter. */
export type RecordingSource =
  /** Retell: a URL straight from the webhook payload. */
  | { kind: "url"; url: string }
  /**
   * Sarvam: no URL anywhere in the payload. Audio is behind a separate
   * analytics endpoint keyed by interaction id, and `interaction_id` is null
   * for a call that never connected — hence a distinct shape rather than a
   * URL the adapter tries to build.
   */
  | { kind: "sarvam"; appId: string; interactionId: string }
  /**
   * Vapi: the payload DOES carry `artifact.recordingUrl`, and it is useless.
   * As of the 2026 storage change those URLs point into a private bucket and
   * return 403 to an unauthenticated GET — which is exactly what happened to
   * all 19 backfilled calls, every one landing `recording_status = failed`
   * while the transcript and trip brief were fine.
   *
   * Audio comes from an authenticated API endpoint keyed by call id instead,
   * so this carries the id rather than the dead URL. Same reasoning as Sarvam:
   * an adapter reports where audio can be OBTAINED, not a link to it.
   */
  | { kind: "vapi"; callId: string }
  /**
   * ElevenLabs: audio arrives TWICE, and neither way is a URL.
   *
   * `post_call_audio` pushes the MP3 inline as base64 on a separate delivery,
   * and there is an authenticated endpoint keyed by conversation id. We use
   * the endpoint, for two reasons that each settle it on their own:
   *
   *   * base64 inflates by a third, and the platform rejects an oversized
   *     request body before any handler runs — so the inline route would lose
   *     audio precisely on the longest calls, which are the best leads.
   *   * a backfilled conversation never re-emits that event, so the fetch path
   *     is needed regardless. Inline would be a second path, not a substitute.
   *
   * The key is per workspace, so this carries the agent's credential_ref
   * rather than reading a fixed environment variable — Rise & Shine's agent
   * and Sarthak's are in different ElevenLabs workspaces.
   */
  | {
      kind: "elevenlabs";
      conversationId: string;
      credentialRef?: string | null;
    };

export function recordingPathFor(
  tenantId: string,
  provider: VoiceProvider,
  providerCallId: string
) {
  return `${tenantId}/${provider}_${providerCallId}.wav`;
}

/**
 * Sarvam's recordings endpoint, whose response shape is UNDOCUMENTED — the
 * published example is literally `{}` (docs.sarvam.ai/conversations/api/
 * analytics/recordings, re-read 2026-08-29, still `{}`). A real inbound call
 * on 2026-08-31 returned raw RIFF/WAV bytes with `content-type: audio/wav`.
 *
 * So this accepts any of the three shapes such an endpoint plausibly returns
 * rather than betting on one: audio bytes directly, or JSON carrying a link
 * under some spelling of "url". Anything else is logged with enough detail to
 * finish the adapter in minutes — see scripts/probe-sarvam.mjs, which answers
 * the question outright once a key exists.
 */
/**
 * Every network call here is bounded. The fetch happens inside the webhook
 * request, so a provider whose media endpoint hangs would hold our response
 * open until the PROVIDER's own timeout fired — at which point it retries the
 * delivery, and we do all of this again. Ten seconds is far longer than a
 * healthy CDN needs and far shorter than any provider's retry threshold.
 */
const FETCH_TIMEOUT_MS = 10_000;

const JSON_URL_KEYS = [
  "url",
  "recording_url",
  "signed_url",
  "download_url",
  "audio_url",
  "recording",
];

async function fetchSarvamRecording(
  source: Extract<RecordingSource, { kind: "sarvam" }>
): Promise<Blob | null> {
  // SARVAM_VOICE_API_KEY, not SARVAM_API_KEY. Sarvam issues two keys and they
  // are not interchangeable: the Voice Agents key covers agents, deployments
  // and the analytics endpoints including this one, while SARVAM_API_KEY is the
  // speech API. This read the speech key and every fetch answered 401 — four
  // attempts per call, then "Recording was not available within 10 minutes",
  // which reads like Sarvam being slow rather than us presenting the wrong
  // credential. Confirmed against a real inbound call on 2026-09-05, and it
  // matches the note in platform_docs/sarvam.md from 2026-08-31: the analytics
  // recording endpoint returns WAV bytes "when called with the Voice Agents API
  // key".
  //
  // The old name is still read as a fallback so a deployment that only has the
  // speech key configured keeps whatever behaviour it had.
  const key = process.env.SARVAM_VOICE_API_KEY ?? process.env.SARVAM_API_KEY;
  const org = process.env.SARVAM_ORG_ID;
  const workspace = process.env.SARVAM_WORKSPACE_ID;

  if (!key || !org || !workspace) {
    // Not an error worth alarming about: a deployment that has not been given
    // Sarvam analytics credentials simply stores calls without audio.
    console.warn(
      "[recordings] SARVAM_VOICE_API_KEY/ORG_ID/WORKSPACE_ID unset — skipping recording fetch"
    );
    return null;
  }

  const endpoint =
    `https://apps.sarvam.ai/api/analytics/v1/${encodeURIComponent(org)}` +
    `/${encodeURIComponent(workspace)}/${encodeURIComponent(source.appId)}` +
    `/recordings/${encodeURIComponent(source.interactionId)}`;

  const res = await fetch(endpoint, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`[recordings] sarvam ${res.status} for ${source.interactionId}`);
    return null;
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
    return await res.blob();
  }

  if (contentType.includes("json")) {
    const body: unknown = await res.json();
    const url =
      body && typeof body === "object"
        ? JSON_URL_KEYS.map((k) => (body as Record<string, unknown>)[k]).find(
            (v): v is string => typeof v === "string" && v.startsWith("http")
          )
        : undefined;

    if (!url) {
      console.error(
        "[recordings] sarvam returned JSON with no recognised url key; keys:",
        body && typeof body === "object" ? Object.keys(body) : typeof body
      );
      return null;
    }
    return await fetchUrl(url);
  }

  console.error(`[recordings] sarvam returned unexpected content-type ${contentType}`);
  return null;
}

/**
 * Vapi's authenticated artifact endpoint.
 *
 * `GET /call/{id}/stereo-recording` with a private API key answers 302 with a
 * short-lived pre-signed URL, and the signed URL needs no credentials of its
 * own.
 *
 * THE REDIRECT IS FOLLOWED BY HAND, and that is the point of this function.
 * `redirect: "follow"` would re-send the `Authorization` header to whatever
 * host the signature points at — Google Cloud Storage or S3, neither of which
 * should ever see a Vapi private key. The fetch spec now strips Authorization
 * across origins, but relying on a runtime to do that correctly is not worth
 * it when reading one header and issuing a clean second request is this cheap.
 *
 * The signed URL is deliberately not cached anywhere: it expires quickly, and
 * Vapi's docs say to ask for a fresh one rather than store the redirect target.
 */
async function fetchVapiRecording(
  source: Extract<RecordingSource, { kind: "vapi" }>
): Promise<Blob | null> {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    // Not worth alarming about: a deployment without a Vapi key stores calls
    // with their transcript and trip brief, just no audio.
    console.warn("[recordings] VAPI_API_KEY unset — skipping recording fetch");
    return null;
  }

  const endpoint = `https://api.vapi.ai/call/${encodeURIComponent(source.callId)}/stereo-recording`;
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // 302 is the documented success path.
  if (res.status >= 300 && res.status < 400) {
    const signed = res.headers.get("location");
    if (!signed) {
      console.error("[recordings] vapi redirected with no location header");
      return null;
    }
    return await fetchUrl(signed);
  }

  // Some clients get the bytes directly rather than a redirect. Accept that.
  if (res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
      return await res.blob();
    }
    console.error(`[recordings] vapi returned unexpected content-type ${contentType}`);
    return null;
  }

  console.error(`[recordings] vapi ${res.status} for call ${source.callId}`);
  return null;
}

/**
 * ElevenLabs audio, from the authenticated conversation endpoint.
 *
 * GET /v1/convai/conversations/{id}/audio with an `xi-api-key` header, which
 * answers with the bytes directly — no redirect dance, unlike Vapi.
 *
 * KNOWN LIMITATION, worth knowing before reading a failure as a credential
 * problem: ElevenLabs finalises audio a moment after the transcript webhook
 * fires, so a very fresh conversation can 404 here. `retrySarvamRecording` is
 * Sarvam-only, so ElevenLabs gets one attempt and then `recording_status` is
 * "failed" for good. Generalising that retry is the next thing to do here if
 * the backfill shows 404s; it is a bigger change than it looks, because that
 * function is also what the audio player polls.
 */
async function fetchElevenLabsRecording(
  source: Extract<RecordingSource, { kind: "elevenlabs" }>
): Promise<Blob | null> {
  const key = elevenLabsApiKey(source.credentialRef);
  if (!key) {
    // Loud, unlike Vapi's equivalent: a missing key here usually means the
    // agent's credential_ref names a workspace nobody configured, which is a
    // setup mistake rather than a deployment without the integration.
    console.error(
      `[recordings] no ElevenLabs key for credential_ref ${JSON.stringify(source.credentialRef ?? null)} — skipping recording fetch`
    );
    return null;
  }

  const endpoint = `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(source.conversationId)}/audio`;
  const res = await fetch(endpoint, {
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.error(
      `[recordings] elevenlabs ${res.status} for conversation ${source.conversationId}`
    );
    return null;
  }
  return await res.blob();
}

async function fetchUrl(url: string): Promise<Blob | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    console.error(`[recordings] fetch ${res.status} for ${url.split("?")[0]}`);
    return null;
  }
  return await res.blob();
}

/**
 * Download the recording and upload it to the private bucket.
 *
 * Returns the storage path on success and null on every failure. Callers must
 * treat null as "no audio for this call yet", never as a reason to fail the
 * webhook: the provider would retry the whole delivery over an asset that is
 * secondary to the call record itself.
 */
export async function storeRecording(args: {
  source: RecordingSource;
  tenantId: string;
  provider: VoiceProvider;
  providerCallId: string;
}): Promise<string | null> {
  const { source, tenantId, provider, providerCallId } = args;

  let audio: Blob | null = null;
  try {
    // A switch rather than a ternary chain, so a fourth provider source is a
    // compile error here instead of silently taking Sarvam's branch.
    switch (source.kind) {
      case "url":
        audio = await fetchUrl(source.url);
        break;
      case "sarvam":
        audio = await fetchSarvamRecording(source);
        break;
      case "vapi":
        audio = await fetchVapiRecording(source);
        break;
      case "elevenlabs":
        audio = await fetchElevenLabsRecording(source);
        break;
    }
  } catch (err) {
    console.error("[recordings] fetch threw", err);
    return null;
  }

  if (!audio || audio.size === 0) return null;

  const path = recordingPathFor(tenantId, provider, providerCallId);
  const { error } = await createAdminClient()
    .storage.from("recordings")
    .upload(path, audio, {
      contentType: audio.type || "audio/wav",
      // Providers retry deliveries; a retry should overwrite the same object
      // rather than fail, so the path stays stable and idempotent.
      upsert: true,
    });

  if (error) {
    console.error("[recordings] upload failed", error);
    return null;
  }

  return path;
}
