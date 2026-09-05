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
| Local (`npm run dev`, tests) | Docker, `supabase start -x vector,logflare,studio` | migrations + `seed.sql` |
| Preview (Vercel) | `eezdyseztlfltmabrely` — project `voxline-preview`, Adnan's personal Supabase org | migrations + `seed.sql` |
| Production (Vercel) | `brodbnufqvtpifhrpama` — project `Voxline`, org `ffivubcaxahyxfacedpx` | migrations only |

The local stack excludes three services deliberately. `vector` bind-mounts the
Docker socket at a path a non-Docker-Desktop runtime does not provide, and
`studio` is only the web dashboard — both fail the whole `supabase start` for
something no test needs. On a Mac without Docker Desktop, `colima start` is the
runtime that works; Docker Desktop's own image pulls stalled indefinitely here
on 2026-09-05, and `~/.docker/config.json` may need `credsStore` removed.

Two env files, and the order matters: `.env.development.local` holds the LOCAL
Supabase credentials and Next reads it first, while `.env.local` is written by
`vercel env pull` and points at PRODUCTION. The Vercel CLI writes values as
`""value""`, which the Supabase CLI refuses to parse — if `supabase status`
complains about `.env.local`, strip the doubled quotes and the multi-line
`VERCEL_OIDC_TOKEN`.

**A new migration has to be pushed to BOTH cloud databases.** Nothing does this
for you, and a schema change that lands on one leaves the other broken at
runtime rather than at build time — a preview deploy whose database is missing
a column 500s on the page that selects it, with nothing failing at build.

Each database is reachable by whoever is in its org, and the two orgs do not
overlap: production is `ffivubcaxahyxfacedpx` (Khush), preview is Adnan's
personal org. Being able to push to one says nothing about the other. Run
`supabase projects list` first — a ref you cannot see is a ref whose password
you cannot read from the dashboard either, and the fix is an org invite, not a
cleverer command.

Link, then push. Take the password through `SUPABASE_DB_PASSWORD` rather than
building a `--db-url`: a password containing `@`, `/`, `#` or `:` breaks URL
parsing, and the resulting error is indistinguishable from a wrong password.

```bash
read -rs "?DB password: " SUPABASE_DB_PASSWORD && echo   # zsh; bash: read -rsp "DB password: "
export SUPABASE_DB_PASSWORD
supabase link --project-ref <ref>
supabase db push
supabase unlink        # ALWAYS. See below.
```

Passwords are in each project's dashboard under Settings → Database. Neither is
stored in this repo; `.env.preview-db` is referenced in older notes but does not
exist.

**`supabase unlink` when you are done.** Linking writes
`supabase/.temp/project-ref`, and every later `supabase` command in that
checkout then aims at the linked project — including `db reset`, which is the
one command that would turn a mistake into a security incident (see below). The
link is a loaded gun left on the table for whoever opens the repo next.

Verify the push landed rather than trusting "Finished supabase db push" — ask
the database, using the service-role key already in `.env.local`:

```bash
set -a && . ./.env.local && set +a
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/<table>?select=<new_column>&limit=1"
```

A missing column comes back as PostgREST error `42703`, which is unambiguous.

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
