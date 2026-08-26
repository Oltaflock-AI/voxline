# Voxline

Multi-tenant SaaS portal for travel agencies built on AI voice agents (Retell AI runtime, ElevenLabs voices). Calls, transcripts, trip pipeline, analytics, usage and billing in one client portal.

A product of Oltaflock AI LLP.

## Read this first

1. [docs/Voxline-Spec.md](docs/Voxline-Spec.md) — product and technical spec v3.0. Wins on data, rules and security.
2. [docs/Voxline-UI-Prototype.html](docs/Voxline-UI-Prototype.html) — design source of truth. Wins on look and interaction. Open it in a browser.
3. [docs/Voxline-Build-Handbook.pdf](docs/Voxline-Build-Handbook.pdf) — illustrated build handbook.

## Stack

Next.js 15 (App Router, TypeScript strict) · Tailwind CSS v4 (Deep Ink tokens mapped in `src/app/globals.css`) · Supabase (Postgres + RLS, Auth, Storage) · Retell AI · Stripe Billing · Resend · Vercel · Sentry.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values from Khush (shared privately, never committed)
npm run dev
```

## Ground rules

- Every data read and write is scoped by tenant. No exceptions.
- Service-role key (`src/lib/supabase/admin.ts`) is server-only: webhooks and admin console. Never in client code.
- Webhook handlers are idempotent — upsert on `retell_call_id`, never insert blind.
- No secrets in the repo, ever.

## Structure

```
src/app/            App Router pages (marketing, portal, /admin, /api)
src/lib/supabase/   client.ts (browser) · server.ts (SSR) · admin.ts (service role)
src/app/globals.css Deep Ink design tokens (dark-first) mapped into Tailwind
docs/               Spec, prototype, handbook
```
