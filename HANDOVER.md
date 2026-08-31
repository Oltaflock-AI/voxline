# Handover — read this first

> **Update, 2026-08-29 — pre-deploy review.** A full pass over the codebase for
> bugs, security holes and UI defects. Nine issues found and fixed, two of them
> serious enough that they would have hit a real pilot in the first month.
> Details in [§6 Review findings](#6-review-findings). Tasks 1–3 are done; only
> deployment remains. Test count is now 20, all passing.

Written 2026-08-28 while you were out. Everything below is on your machine and
working. Nothing is committed — the tree is yours to review.

---

## 1. Start it up (2 minutes)

```bash
cd /Users/Adnan/Documents/Oltaflock/voxline
```

Docker Desktop needs to be running (whale icon in the menu bar). Then:

```bash
supabase start && npm run dev
```

Sign in at http://localhost:3000/login

| User | Sees | Password |
|---|---|---|
| `sofia@voxline.test` | Both agencies — use this one | `voxline-dev-only` |
| `marco@voxline.test` | Blue Harbor only | same |
| `elena@voxline.test` | Wanderlux only | same |
| `admin@voxline.test` | `/admin` console | same |

Marco and Elena exist to prove tenant isolation. Sofia is the demo account.

Other useful URLs: Supabase Studio at http://127.0.0.1:54323 (click around the
database), Mailpit at http://127.0.0.1:54324 (catches outgoing email).

---

## 2. Your four tasks

**Tasks 1–3 are complete** (RLS policies, the Calls tab, the pipeline stage
control). Only Task 4, deployment, is left — it needs your Supabase and Vercel
logins. The first three are kept below as a record of what was built and why.

### Task 1 — Finish the RLS policies · DONE
**File:** `supabase/migrations/20260828120100_rls.sql`

Four worked examples are written, six `TODO(adnan)` remain. The file tells you
for each table whether clients read it, write it, or neither.

**Three things in the app are visibly broken right now, and all three are this
task:** the status pill says "Agent paused" when the seed says live, the plan
reads "—" instead of GROWTH, and the sidebar shows your email instead of "Sofia
Marchetti". Nothing is wrong with that code — `voice_agents`, `plans` and
`profiles` have RLS on with no policy, so the database is refusing the rows.
Write the policies and all three fix themselves with no TypeScript changes.
That is the most direct demonstration of what RLS actually is.

Apply with `npm run db:reset`, then prove it with the snippet at the bottom of
the file. **Keep the `begin;`** — the reason why is commented there, and
getting it wrong produces a test that passes for the wrong reason.

Also un-skip the agent test in `tests/portal.spec.ts` when this lands.

### Task 2 — Build the Calls tab · DONE
**File:** `src/app/app/[tenant]/calls/page.tsx`

Your vertical slice — one screen owned end to end, and every other screen is a
variation on it. The full brief is in the comment at the top of the file, in
build order.

The expandable rows, transcript, audio player and trip brief are already
written and working (the Overview's "Recent calls" uses the same component, so
you can see them working before you start). You are writing the query, the
filter chips with counts, pagination, and per-filter empty states.

The one idea worth getting from this task: **filter state goes in the URL, not
in `useState`.** That is what keeps it a Server Component — the page re-runs on
the server with a new query and the browser receives 25 rows instead of 337.

Un-skip the two calls tests in `tests/portal.spec.ts` when done.

### Task 3 — The pipeline stage change · DONE
**File:** `src/app/app/[tenant]/pipeline/actions.ts`

The only place a client writes to the database. The board renders already; the
cards just cannot move yet. Spec §6.4 permits a dropdown instead of drag and
drop, but explicitly forbids shipping cards that cannot move at all.

Four things to get right are listed in the file. The interesting one: you do
**not** need a `tenant_id` check in this action, because the `with check`
clause you wrote in Task 1 already makes it impossible to move a lead into
another agency. Try it and watch the database refuse.

### Task 4 — Deploy · REMAINING · ~45 min, needs your accounts
Needs your logins, so I could not do it:

1. `supabase login`, then create the cloud project. **Ask Khush the region
   question first** — it is irreversible (spec §11 open item 2). Recommend
   `ap-south-1` Mumbai if the pilot agencies are Indian.
2. `supabase link` then `supabase db push` to apply migrations to the cloud.
3. `npm i -g vercel`, `vercel link`, add the env vars from `.env.example` to
   all three environments, `vercel deploy --prod`.
4. Point the Retell webhook at `https://<domain>/api/webhooks/retell` and set
   `RETELL_WEBHOOK_SECRET` to match.

**Do not run `supabase/seed.sql` against the cloud project.** It truncates
every table and creates users with a known password. It says so at the top.

---

## 3. What I built, and the six ideas behind it

Read the code in this order and the architecture explains itself.

### Concept 1 — Where the code runs
**`src/app/login/page.tsx` + `login-form.tsx`.** The page is a Server
Component: it renders once on the server and ships no JavaScript for itself.
The form is `"use client"` because it needs pending state. Same screen, two
execution environments, one import boundary between them.

I hit this the hard way mid-build. `call-list.tsx` is a Client Component and
imported one constant from `metrics.ts` — which also imports the Supabase
server client. The build failed: importing one export pulls in the whole
module, so `next/headers` was being dragged into the browser bundle. The fix is
`src/lib/outcomes.ts`, a leaf module that imports nothing but types. **The
split is per module, not per export.**

### Concept 2 — The request lifecycle
**`src/app/app/[tenant]/page.tsx` → `src/lib/metrics.ts`.** Pick the "96" on
the dashboard and follow it: URL → layout resolves the tenant → `getOverviewMetrics`
queries `calls` → RLS filters to your tenant → counted in JS → rendered. No
API layer, no fetch, no loading spinner. The Server Component awaits Postgres
directly.

### Concept 3 — Auth is a cookie
**`src/proxy.ts`.** Login sets a JWT cookie; every later request carries it;
Postgres reads the user id out of it via `auth.uid()`. This file refreshes that
cookie and gates protected routes.

Two things worth knowing. It is `proxy.ts`, not `middleware.ts` — Next.js 16
renamed the file and the exported function, so every tutorial you find online
is now wrong. And it calls `getUser()`, never `getSession()`: `getSession()`
trusts whatever is in the cookie, `getUser()` verifies it with the auth server.
In a security gate, trusting a value the client could have edited is the whole
vulnerability.

### Concept 4 — RLS is the real boundary
**`supabase/migrations/20260828120100_rls.sql` + `tests/isolation.spec.ts`.**
The tests go through the Supabase API as a real signed-in user rather than
through the UI — on purpose. The UI could be hiding rows with a filter while
the API hands them to anyone with a session token and curl. What has to be
proved is that the *database* refuses.

Two subtleties I hit:
- The natural policy (`tenant_id in (select ... from memberships ...)`) causes
  infinite recursion, because `memberships` has RLS too. Hence the
  `security definer` helper `auth_tenant_ids()`, with `set search_path = ''` so
  it cannot be hijacked by shadowing the table.
- Update needs **both** `using` and `with check`. `using` asks "may I touch
  this row", `with check` asks "is the row legal afterwards". With only the
  first, a user can take a lead they own and reassign its `tenant_id` into a
  competitor's board. There is a test for exactly that.

### Concept 5 — Data in ≠ data out
**`src/app/api/webhooks/retell/route.ts` + `src/lib/retell.ts`.** The five
rules this handler lives by are at the top of the route.

The one that matters most is **idempotency**. Retell retries, and `call_ended`
and `call_analyzed` are two events about the same call. Both must land on one
row. That is what the `UNIQUE` constraint on `retell_call_id` plus `upsert` buys
— verified: firing both events produces one call, one lead, and minutes counted
once.

The second is that a non-2xx makes Retell retry forever. So: 401 for a bad
signature, 500 only for things a retry might fix, 200 for everything else
including events we deliberately ignore.

Try it:
```bash
node scripts/send-test-webhook.mjs --bad-signature   # 401
node scripts/send-test-webhook.mjs                   # 200, creates a call + lead
node scripts/send-test-webhook.mjs --event call_analyzed   # same row, no duplicate
```

### Concept 6 — Where aggregation happens
**`src/lib/metrics.ts`.** The KPIs pull 14 days of rows and count them in
JavaScript. Spec §8 explicitly allows that for Phase 1, and the comment
explains when it stops being acceptable and what replaces it (a `daily_stats`
rollup so Postgres returns 14 rows instead of 14,000). It is deliberately not
optimised yet — pre-aggregating would lock in today's definition of "trip
inquiry", which is exactly what a pilot is likely to change.

Related, in `supabase/migrations/20260828120300_usage_rpc.sql`: minute counting
is a Postgres function, not three queries in TypeScript, because read-add-write
from two concurrent webhooks silently loses one call's minutes. Atomic upsert
with the arithmetic in the `SET` clause.

---

## 4. Two bugs I hit that cost real time

**Login failed with "wrong password" and it was neither.** Seeding `auth.users`
by raw SQL leaves eight token columns NULL. GoTrue reads them into Go `string`
fields, which cannot hold NULL, so it 500s — and the UI honestly reports that
as a bad password. Commented in `seed.sql`. Diagnosed from
`docker logs supabase_auth_voxline`, which is where to look when auth
misbehaves.

**The dashboard said 100 in dev and would have said 96 in production.**
Postgres truncates days in UTC; the app was computing its 7-day window with
`setHours()`, which uses the server's local timezone — IST on your laptop, UTC
on Vercel. Same data, different number depending on where the process runs.
Now everything is UTC.

That fix is consistent but not *correct*: a Miami agency's "today" is not
UTC's, so their evening calls land on tomorrow's bar. The real answer is a
per-tenant timezone column. **This is a question for Khush** — it is in the
build plan's list.

---

## 5. Where things stand

| | |
|---|---|
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean, 11 routes |
| `npm test` | 12 passing, 3 skipped (each tied to one of your tasks) |
| Committed | nothing — review the tree first |

**Built:** schema + 12 tables + indexes · seed matching the prototype exactly ·
storage bucket with tenant-scoped signed URLs · session handling and route
gating · login/logout · portal shell with tenant switcher and both themes ·
Overview with real KPIs, sparklines, volume and outcomes · call components
(transcript, player, trip brief) · pipeline board · agent setup + change
request modal · billing on real plan and usage data · admin console · Retell
ingestion with signature verification and idempotency · marketing landing page ·
Playwright suite including 7 isolation tests · CI running all of it.

**Cut, and Khush needs to confirm:** Stripe billing (S-3), drag and drop,
command palette, Resend emails, marketing rebuild, nightly reconciliation.
Reasoning is in `../VOXLINE_BUILD_PLAN.md`.

**Open questions for Khush**, all in the build plan: Supabase region
(blocking, irreversible), per-tenant timezone, the `calls.outcome` enum gap
(no bucket for "busy, call back later"), and confirming the cut list.

---

## 6. Review findings

A pre-deploy pass over the whole codebase: correctness, security, UI, and
whether anything holds up at realistic volume. Everything below is already
fixed and verified — this is the record of what was wrong and why it mattered.

### Two that would have hit a real customer

**1. Every count broke silently above 1000 calls.** `CRITICAL`

PostgREST caps responses at `max_rows = 1000` and does it silently — no error,
no flag. The Overview and the Calls chips both counted by fetching raw rows and
tallying in JavaScript, so past 1000 calls they were simply wrong.

I reproduced it by loading Blue Harbor with 1,369 calls:
- the sidebar said **Calls 1369** while the "All" chip said **1000**, on the
  same screen
- the Overview said 927 calls handled, and because rows arrive oldest-first,
  the days dropped were the *newest* — the volume chart showed **0 calls for
  today**

Spec §8 targets "thousands of calls", and a Scale tenant (6,000 minutes ≈ 1,500
calls/month) crosses 1000 inside the 14-day comparison window. This was
guaranteed, not hypothetical.

Fixed by moving the aggregation into Postgres
(`supabase/migrations/20260829120000_stats_rpc.sql`): two `SECURITY INVOKER`
functions that group server-side and return ≤56 rows instead of thousands. RLS
still applies, so a tenant can only aggregate its own calls. Re-tested at 1,369
calls: every number now matches the database exactly.

**2. Retried webhooks double-billed the customer.** `CRITICAL`

The call row upserted idempotently, but `add_call_minutes()` did not. Retell
retries on timeout, so a redelivered `call_ended` billed the same call twice —
silent over-billing that nothing in the UI would ever reveal.

Fixed with a `minutes_counted_at` claim column and an atomic
`UPDATE ... WHERE minutes_counted_at IS NULL`, which exactly one caller can win.
Verified with **8 concurrent identical deliveries**: one call row, one lead,
5.00 minutes billed once.

### Also fixed

**3. A follow-up event wiped fields the first one set.** `call_analyzed`
usually omits duration, recording and phone number, and the handler wrote the
whole object unconditionally — so the second event blanked duration to 0,
recording to null and the transcript to empty. Now only fields the payload
actually carries are written.

**4. Duplicate leads under concurrency.** Lead creation was a check-then-insert
race. Replaced with a unique index on `leads.call_id` and an upsert.

**5. Open-redirect bypass on login.** The `?next=` guard rejected `//evil.com`
but not `/\evil.com` — browsers normalise the backslash, making it
protocol-relative and off-site. Both forms and control characters now rejected.

**6. The webhook was doing an auth round-trip it didn't need.** `proxy.ts`
matched `/api/webhooks/*`, so every ingestion request called `getUser()` against
the auth server before being ignored — on the hottest path in the product, twice
per call, and coupling ingestion to auth being up. Now excluded.

**7. Duplicated queries on every page load.** `requireTenant()` ran in both the
layout and the page, and `getUser()` in three places, each a separate
round-trip. Wrapped in React `cache()` so they run once per request.

**8. The change-request modal rendered clipped inside the card.** It looked
transparent; it was actually a 970×696 scrim in a 1300×800 window. Cause was
three steps away: `.panel` has `animation: fade ... both`, whose final keyframe
sets `transform: none` — and even an identity transform makes an element the
containing block for `position: fixed` descendants. Now rendered through a
portal so no ancestor style can clip it again.

**9. No way to sign out on mobile.** `.side-foot` — the only sign-out control —
was `display:none` under 1000px. Spec §10 makes the responsive portal *the*
mobile experience, so phone users simply could not log out. Now visible.

### UI improvements

- **Branded 404.** `requireTenant()` calls `notFound()` for any agency you are
  not a member of, so this page is reached on ordinary mistakes, not just
  typos. It was Next's unstyled black default with no way back.
- **Error boundary** with a retry and a support reference, instead of a bare
  "something went wrong" whenever a Server Component throws.
- **Single-tenant switcher** no longer shows a dropdown chevron. Most real
  agencies have exactly one tenant, so nearly every production user was seeing
  a control that promised a choice that did not exist.

### What was checked and found clean

RLS holds across every table (7 isolation tests) · cross-tenant access by URL
404s and by direct API returns zero rows · service-role key absent from the
client bundle (verified against the built output) · no `dangerouslySetInnerHTML`
beyond the theme script · no `any` escapes · no server-only module reachable
from a Client Component · `npm audit` clean · both themes render on every page ·
change-request, admin pause and audit logging all verified end to end.

### Test coverage added

Five new tests in `tests/ingestion.spec.ts`, each on a throwaway tenant so they
cannot disturb the demo data: bad-signature rejection, 8-way concurrent
delivery, sparse-event field preservation, and two volume tests above the
1000-row cap — one at the RPC level and one **end to end through the UI**.

The end-to-end one matters most: an RPC-only test would still pass if someone
reverted the page to counting rows in JavaScript. I verified it actually catches
the regression by reintroducing the bug and confirming the test fails.
