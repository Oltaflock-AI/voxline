<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Voxline — agent guide

Multi-tenant SaaS portal for travel agencies built on AI voice agents (Retell AI runtime, ElevenLabs voices). A product of Oltaflock AI LLP.

## Source of truth

1. `docs/Voxline-Spec.md` — product + technical spec. Wins on data, rules, security.
2. `docs/Voxline-UI-Prototype.html` — design source of truth. Wins on look and interaction.
3. `docs/Voxline-Build-Handbook.pdf` — illustrated build handbook.

When spec and code disagree, spec wins — flag the mismatch rather than silently following the code.

## Stack

- Next.js 16 (App Router, TypeScript strict) — README may still say 15; package.json is authoritative
- Tailwind CSS v4 — Deep Ink design tokens mapped in `src/app/globals.css`; use tokens, no hard-coded colors
- Supabase (Postgres + RLS, Auth, Storage) via `@supabase/ssr`
- Retell AI (voice runtime) · Stripe Billing · Resend · Sentry · Vercel

## Commands

```bash
npm run dev      # local dev server
npm run build    # production build — run before pushing non-trivial changes
npm run lint     # eslint
```

## Environment variables

- Vercel is the source of truth for credentials (project `oltaflock-ai/voxline`, all three environments). Never paste secrets into files that get committed or into chat.
- Local setup: `vercel link` then `vercel env pull .env.local --yes`. Re-pull after any `vercel env add` or dashboard change (also refreshes the ~12h `VERCEL_OIDC_TOKEN`).
- `vercel env pull` overwrites `.env.local` entirely — keep hand-added local vars in `.env.dev.local` instead. Note: this repo's `.gitignore` ignores all `.env*` except `.env.example`.
- New variables: add the key (empty) to `.env.example` with a comment, add real values via `vercel env add NAME <env>` per environment.
- Names the code expects: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the first two carry the `NEXT_PUBLIC_` prefix, the service key must not.

## Supabase clients (`src/lib/supabase/`)

| File | Use in | Key |
|------|--------|-----|
| `client.ts` | Client Components ("use client") | anon |
| `server.ts` | Server Components, route handlers, server actions | anon + user cookies |
| `admin.ts` | Webhooks + admin console ONLY, server-side only | service role (bypasses RLS) |

Never import `admin.ts` from anything reachable by client code.

## Ground rules

- Every data read and write is scoped by tenant. No exceptions. RLS is the enforcement layer; queries still filter explicitly.
- Webhook handlers are idempotent — upsert on `retell_call_id`, never insert blind.
- No secrets in the repo, ever. `NEXT_PUBLIC_` prefix means browser-exposed — never put a secret there.
- TypeScript strict stays on; don't weaken tsconfig or sprinkle `any`/`!` to silence errors (the existing `process.env.X!` in the Supabase clients is the sanctioned exception).

## Deploy

- Production deploys via `vercel deploy --prod` (or Git integration once wired). Preview: plain `vercel deploy`.
- Env var changes require a redeploy to take effect.
