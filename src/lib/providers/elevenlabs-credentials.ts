/**
 * ============================================================================
 * Which ElevenLabs credential belongs to which agent.
 * ============================================================================
 *
 * ElevenLabs keys and webhook secrets are WORKSPACE-scoped, and Voxline's two
 * ElevenLabs clients are in different workspaces on different logins:
 *
 *   Sarthak Singapore   three agents, the Oltaflock workspace   default key
 *   Rise & Shine        one agent, a separate workspace         `riseshine`
 *
 * A key from one workspace cannot see the other's agents. It fails with
 * "Document with id … not found", which reads like a deleted agent rather than
 * a wrong credential — that exact confusion already cost a day once, recorded
 * in platform_docs/elevenlabs.md.
 *
 * So `voice_agents.credential_ref` names the workspace and these two functions
 * turn that name into an environment variable.
 *
 * THE COLUMN HOLDS A NICKNAME, NOT A VARIABLE NAME, AND THAT IS THE POINT.
 *
 * `process.env[row.credential_ref]` would let anyone who can write that column
 * point it at SUPABASE_SERVICE_ROLE_KEY and have Voxline send its own
 * service-role key to ElevenLabs in a request header. Building the name here,
 * from a pattern-checked nickname, makes that impossible rather than merely
 * unlikely — and the same check exists on the column, for the hand-written
 * UPDATE the application never sees.
 *
 * Adding a third workspace is two Vercel variables and a `credential_ref` on
 * the agent. No code change, no migration.
 *
 * The right long-term answer is a credential per agent held in a secret store
 * that Voxline can read at runtime, so onboarding a client does not mean
 * editing Vercel. That is the provider control plane's problem; this is the
 * smallest thing that is correct in the meantime.
 */

/**
 * Lowercase, digits and underscore only, and short.
 *
 * Anything else resolves to no credential at all rather than to some other
 * variable — a malformed ref must fail closed.
 */
const REF_PATTERN = /^[a-z0-9_]{1,32}$/;

function resolve(prefix: string, ref: string | null | undefined): string | undefined {
  if (!ref) return process.env[prefix];
  if (!REF_PATTERN.test(ref)) {
    // The ref itself is not a secret, but log it as a configuration error
    // rather than silently falling back to the default workspace's key — that
    // would send one client's credential at another client's agent.
    console.error(
      `[elevenlabs] credential_ref ${JSON.stringify(ref)} is malformed; refusing to resolve a credential`
    );
    return undefined;
  }
  return process.env[`${prefix}_${ref.toUpperCase()}`];
}

/** The API key for reading an agent's conversations, transcripts and audio. */
export function elevenLabsApiKey(ref?: string | null): string | undefined {
  return resolve("ELEVENLABS_API_KEY", ref);
}

/**
 * The HMAC secret for verifying that workspace's post-call webhook.
 *
 * Per workspace, like the key: ElevenLabs generates a secret when the webhook
 * is created, and a webhook is created inside one workspace. Verifying Rise &
 * Shine's delivery against Sarthak's secret fails in a way indistinguishable
 * from a forged request.
 */
export function elevenLabsWebhookSecret(ref?: string | null): string | undefined {
  return resolve("ELEVENLABS_WEBHOOK_SECRET", ref);
}
