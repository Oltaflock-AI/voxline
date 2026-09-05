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
- Retell AI · Sarvam · Vapi (voice runtimes) · Dodo Payments (billing — NOT Stripe: Stripe needs a US entity; `docs/Voxline-Spec.md` still says Stripe and is out of date on this point) · Resend · Sentry · Vercel

## Commands

```bash
npm run dev      # local dev server
npm run build    # production build — run before pushing non-trivial changes
npm run lint     # eslint
```

## Environment variables

- Vercel is the source of truth for credentials (project `oltaflock-ai/voxline`, all three environments). Never paste secrets into files that get committed or into chat.
- Local setup: `vercel link` then `vercel env pull .env.local --yes`. Re-pull after any `vercel env add` or dashboard change (also refreshes the ~12h `VERCEL_OIDC_TOKEN`).
- `vercel env pull` overwrites `.env.local` entirely — keep hand-added local vars in `.env.development.local` instead. It must be that exact name: Next looks up `.env.$(NODE_ENV).local` and `next dev` sets `NODE_ENV=development`, so a file called `.env.dev.local` is never read and the variable is simply absent with no warning. `.env.development.local` also takes precedence over `.env.local`, so it survives a pull. Both are covered by the `.env*` rule in `.gitignore` (only `.env.example` is committed).
- New variables: add the key (empty) to `.env.example` with a comment, add real values via `vercel env add NAME <env>` per environment.
- Names the code expects: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the first two carry the `NEXT_PUBLIC_` prefix, the service key must not.

## Environments and their databases

Three environments, three separate Postgres databases. They are not copies of
each other and never sync.

| Environment | Database | Holds |
|---|---|---|
| Local (`npm run dev`, tests) | Docker, `supabase start` | migrations + `seed.sql` |
| Preview (Vercel) | `eezdyseztlfltmabrely` — project `voxline-preview`, Adnan's personal Supabase org | migrations + `seed.sql` |
| Production (Vercel) | `brodbnufqvtpifhrpama` — Khush's Supabase org | migrations only |

**A new migration has to be pushed to BOTH cloud databases.** Nothing does this
for you, and a schema change that lands on one leaves the other broken at
runtime rather than at build time. Push with `--db-url`; do not `supabase link`,
because production is in an org most of us cannot see:

```bash
supabase db push --db-url "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
```

Production's password comes from Khush. Preview's is in `.env.preview-db`
(gitignored by the `.env*` rule, like every other env file here).

**`seed.sql` must never reach production.** It inserts straight into
`auth.users` and `platform_admins`, so it creates working logins including a
platform admin, and the password is a literal in this public repo. It is safe
today because seeds only run on `supabase db reset`, which is a local command,
and `db push` applies migrations alone. That safety is entirely a property of
which command you run:

- **Never run `supabase db reset` against a cloud database.** Not linked, not
  with `--db-url`. It drops everything and then runs the seed. It is the one
  command that turns a mistake into a security incident.
- Anything a migration owns must survive a reseed. `plans` is reference data
  and lives in `migrations/20260902090000_plans_reference_data.sql`; it used to
  be truncated by `seed.sql`, which deleted the rows the migration had just
  inserted and broke every local reset.

**Reference data vs seed data.** Reference data is rows the product is defined
in terms of, and belongs in a migration. Seed data is example content that
makes a local database pleasant to work against, and belongs in `seed.sql`. If
a production feature breaks without a row, it is reference data.

**Local env must not point at production.** `vercel env pull` overwrites
`.env.local` with the DEPLOYED configuration. Keep local Supabase credentials in
`.env.development.local`, which Next reads first and a pull cannot clobber.
`playwright.config.ts` loads the two files in that same order for the same
reason: it once ran the whole suite, isolation tests included, against
production.

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
