import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Testing real Sarvam webhooks needs a public HTTPS URL for the dev server,
  // which a disposable `cloudflared tunnel --url http://localhost:3000` gives
  // us — but it mints a new random subdomain every time it restarts, so a
  // wildcard here is the only version of this that doesn't need re-editing
  // per tunnel. Dev-only: Next enforces allowedDevOrigins under `next dev`
  // alone, so this has no effect on the production build.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
