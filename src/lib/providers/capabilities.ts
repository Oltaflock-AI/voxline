import type { VoiceProvider } from "@/lib/ingest";

/**
 * What each provider lets Voxline do over its API — as verified, not as
 * advertised. The admin console renders against this so it never shows a
 * control that will fail.
 *
 * Sarvam (probed 2026-09-04 with a working Voice Agents key): deployments,
 * campaigns, outbound and analytics exist; `apps`, `agents`, `knowledge-bases`
 * and `phone-numbers` all 404. So Sarvam can be CONNECTED (list its
 * deployments, adopt one, set its webhook) but not BUILT from here — the
 * prompt and voice are authored in Sarvam's console.
 *
 * Retell and Vapi have agent-management APIs and will support both. They are
 * off here until their client exists; flipping a flag without the code behind
 * it would put a button on the page that 500s.
 *
 * ElevenLabs ingests calls (adapter + webhook route, brief task 3) but is not
 * CONNECTABLE: its post-call webhook is created in the ElevenLabs console and
 * selected per agent there, and Voxline has no code that writes it. Marking it
 * connectable would render a Connect panel whose button cannot work.
 */
export type ProviderCapabilities = {
  label: string;
  connect: boolean;
  build: boolean;
  note: string;
};

export const PROVIDER_CAPABILITIES: Record<VoiceProvider, ProviderCapabilities> = {
  sarvam: {
    label: "Sarvam",
    connect: true,
    build: false,
    note:
      "Author the agent in Sarvam's console, then connect its deployment here. Voxline sets the webhook, records the number and tracks the version.",
  },
  vapi: {
    label: "Vapi",
    connect: false,
    build: false,
    note: "Coming next. Until then, paste the assistant ID into the agent form.",
  },
  retell: {
    label: "Retell AI",
    connect: false,
    build: false,
    note: "Coming after Vapi. Until then, paste the agent ID into the agent form.",
  },
  elevenlabs: {
    label: "ElevenLabs",
    connect: false,
    build: false,
    note:
      "Paste the agent ID here, then create a post-call webhook in the ElevenLabs console pointing at the URL on the Webhooks page. Voxline verifies the signature but cannot set the webhook for you.",
  },
};

/**
 * Display order in the picker. Sarvam first because it is the one that works.
 *
 * NOT exhaustive over the enum — this is a plain array, so adding a provider
 * is NOT a compile error here. Forget to add it and the provider silently
 * never appears in the admin picker, with nothing failing anywhere.
 */
export const PROVIDER_ORDER: VoiceProvider[] = [
  "sarvam",
  "elevenlabs",
  "vapi",
  "retell",
];
