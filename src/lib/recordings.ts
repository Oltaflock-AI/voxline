import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

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
  | { kind: "sarvam"; appId: string; interactionId: string };

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
  const key = process.env.SARVAM_API_KEY;
  const org = process.env.SARVAM_ORG_ID;
  const workspace = process.env.SARVAM_WORKSPACE_ID;

  if (!key || !org || !workspace) {
    // Not an error worth alarming about: a deployment that has not been given
    // Sarvam analytics credentials simply stores calls without audio.
    console.warn(
      "[recordings] SARVAM_API_KEY/ORG_ID/WORKSPACE_ID unset — skipping recording fetch"
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
    audio =
      source.kind === "url"
        ? await fetchUrl(source.url)
        : await fetchSarvamRecording(source);
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
