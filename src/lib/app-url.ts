/**
 * The public base URL of whatever is currently running.
 *
 * SERVER ONLY. `VERCEL_URL` and friends carry no `NEXT_PUBLIC_` prefix, so
 * they do not reach the browser. Every caller so far is a Server Component.
 *
 * This exists because `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`
 * fails in a way nobody notices. The admin Webhooks page builds the URLs that
 * get pasted into the Retell and Sarvam consoles, and with the variable unset
 * it produced `http://localhost:3000/api/webhooks/...` on a deployed site.
 * That is a real-looking URL which a provider will happily accept and can
 * never reach, so calls simply never arrive and nothing anywhere reports an
 * error. A wrong answer is worse than a missing one here.
 *
 * The order matters:
 *
 *   1. NEXT_PUBLIC_APP_URL   an explicit override, and the only way to name a
 *                            custom domain. Wins whenever it is set.
 *   2. VERCEL_PROJECT_PRODUCTION_URL  in production. This is the project's
 *                            stable domain, NOT the per-deployment one, which
 *                            is what a provider console needs: a webhook is
 *                            configured once and must survive the next deploy.
 *   3. VERCEL_URL            on a preview. Changes every deployment, which is
 *                            correct here, because the point of a preview is
 *                            to aim a webhook at that specific build.
 *   4. localhost             development.
 *
 * Vercel's variables omit the protocol, so it is added back.
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const isProduction = process.env.VERCEL_ENV === "production";
  const host = isProduction
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : process.env.VERCEL_URL;

  if (host) return `https://${host}`;

  return "http://localhost:3000";
}
