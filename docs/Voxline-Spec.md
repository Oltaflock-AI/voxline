# Voxline, Product & Technical Specification

**Version:** 3.0 · **Date:** August 21, 2026 · **Owner:** Khush Mutha (Oltaflock AI LLP)
**Build owner:** Adnan (intern) · **Reviewer:** Khush
**Design source of truth:** `Voxline-UI-Prototype.html`. Where this document and the prototype disagree, the prototype wins on look and interaction, this document wins on data, rules and security.
**Supersedes:** v1.0 (`_superseded/voxlinespec.md`) and `voxline.html`. Do not build from the v1 files.

---

## 0. What changed in v2

| Area | v1 | v2 |
|---|---|---|
| Visual system | Light-first "ocean" teal, Space Grotesk + Inter | Dark-first "Deep Ink", near-black canvas, one electric teal accent, Inter + Instrument Serif + JetBrains Mono |
| Brand | Unclear relationship to Oltaflock | Voxline is a standalone product brand. Oltaflock AI appears only as "A product of Oltaflock AI LLP" in the footer and legal copy |
| Portal shell | Top nav with inline tabs | Persistent sidebar, tenant switcher, sticky glass topbar, command palette |
| Calls | Static scrub bar | Real player UI, speaker-labelled transcript, structured trip-brief block linking to the lead |
| Pipeline | Static columns | Drag and drop between stages with persistence |
| Feedback | None | Toasts, empty states, loading and count-up motion, focus rings |
| Marketing | Feature list | Live simulated call in the hero, bento feature grid, two-column FAQ, editorial quote band, single conversion path |
| Brand system (2.1) | A logo and a colour | A waveform motif reused as divider, watermark, loader, empty-state art and live indicator, plus an uppercase letterspaced wordmark |
| Material (2.1) | Flat cards | Glass fill, inner top highlight, gradient hairline borders, pointer-tracked hero spotlight |
| Typography (2.1) | Serif on marketing only | Serif carries into the portal for card and panel titles, empty states and modals, with per-step tracking |

Everything else in v1 (architecture, data model, tenancy rules, phases) still stands and is restated here in full so this file is the only one anyone needs.

---

## 1. Product overview

Voxline is a multi-tenant SaaS platform for travel agencies built on AI voice agents (Retell AI runtime, ElevenLabs voices). The voice agent answers the agency's inbound line, captures a structured trip brief (destination, dates, party size, budget, occasion) and routes the inquiry to the agency's consultants.

What we build is the client-facing platform around those agents:

- **Client portal**, where each agency logs in and sees its own calls, transcripts, trip pipeline, analytics, usage and billing.
- **Internal admin console**, where the Oltaflock team onboards agencies, wires their voice agents and manages plans.
- **Marketing site**, which sells the product and links into the portal.

**Business model:** subscription plans with included voice minutes plus per-minute overage. Starter $199/mo for 800 minutes, Growth $499/mo for 2,500 minutes, Scale custom from 6,000 minutes. Billing runs through Stripe.

**Positioning:** self-serve productised service. A new client is handed a login, not a kickoff deck. The portal has to look like a product they pay for, which is the entire reason for the v2 design pass.

### What Voxline is not, for now
- Not a general call-centre product. Travel agencies only.
- Not a CRM. It syncs to the agency's CRM, it does not replace it.
- Not a telephony stack. Retell and ElevenLabs own the voice runtime. We consume their APIs and webhooks.
- Not a booking or payment engine. The agent qualifies, humans sell.

---

## 2. Users and roles

| Role | Who | Access |
|---|---|---|
| **Platform admin** | Oltaflock team | `/admin`: all tenants, agent config, plans, change requests, "view as client" |
| **Agency owner** | The agency's account owner | Full portal for their tenants, including billing |
| **Agency member** | Consultant or staff seat | Portal minus billing management. Phase 2 |

A **tenant is one travel agency**. One user can belong to several tenants (the switcher in the prototype shows an agency group with two brands). Every data read and write is scoped by tenant, without exception.

---

## 3. Tech stack

Keep the shape even if a component is swapped: managed Postgres with row-level security, a serverless-friendly web framework, webhook-driven ingestion.

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 15+ (App Router, TypeScript strict)** | One codebase for marketing site, portal and API routes |
| Styling | **Tailwind CSS v4** with the v2 tokens mapped into the theme, plus shadcn/ui primitives where they save time | The prototype's CSS variables map one to one onto Tailwind theme tokens |
| Database | **PostgreSQL on Supabase** | Managed Postgres, RLS for tenant isolation, auth, private storage for recordings |
| Auth | **Supabase Auth**, email and password plus magic link. Google SSO later | Integrated with RLS |
| Voice | **Retell AI** agent runtime and telephony, **ElevenLabs** voices | Phone numbers, call orchestration, webhooks with transcript and post-call analysis |
| Payments | **Stripe Billing**, base subscription plus metered usage | Native support for included minutes plus overage |
| Charts | Hand-rolled SVG as in the prototype, or Recharts if a chart gets complex | The v2 sparklines and bars are 40 lines of SVG, do not pull in a library for them |
| Email | **Resend** | Invites, notifications, daily digest |
| Hosting | **Vercel** for the app, Supabase for data | Zero ops for a small team |
| Monitoring | **Sentry** plus Vercel analytics | Error triage from day one |

---

## 4. System architecture

```
                            +--------------------------+
  Caller --> agency number  |  Retell AI (voice agent) |
                            |  + ElevenLabs voice      |
                            +------------+-------------+
                                         | webhooks: call.started /
                                         | call.ended / call.analyzed
                                         v
     +-------------------------------------------------------+
     |               Next.js app (Vercel)                    |
     |  /            marketing site (public)                 |
     |  /app         client portal (auth, tenant scoped)     |
     |  /admin       internal console (platform admins)      |
     |  /api/webhooks/retell    call ingestion               |
     |  /api/webhooks/stripe    billing events               |
     +------------------------+------------------------------+
                              |
                              v
     +-------------------------------------------------------+
     |  Supabase: Postgres (RLS) · Auth · Storage (audio)    |
     +-------------------------------------------------------+
                              |
                              v
        Stripe (subscriptions, metered overage)
        HubSpot / Salesforce (CRM sync, Phase 2)
```

**Call ingestion, the heart of the product:**

1. Retell fires `call.ended` or `call.analyzed` to `/api/webhooks/retell`.
2. The handler verifies the signature, resolves the tenant from the Retell agent ID, and upserts a `calls` row on `retell_call_id`: duration, recording URL, transcript, and the structured post-call analysis fields (destination, travel dates, party size, budget, occasion, outcome).
3. If the outcome is `inquiry_captured` or `quote_requested`, create a `leads` row in stage `new_inquiry`, linked to the call.
4. Increment the tenant's minutes for the current billing period and report metered usage to Stripe.
5. Phase 2: push the lead to the agency's CRM and send the notification email.

Handlers must be **idempotent**, Retell retries. Upsert on `retell_call_id`, never insert blind.

---

## 5. Data model (Postgres)

Every tenant-owned table carries `tenant_id` with an RLS policy enforcing `tenant_id in (select tenant_id from memberships where user_id = auth.uid())`. Platform admins use the service role in `/admin` server code only. The service key never reaches a client bundle.

```sql
tenants         id, name, slug, initials, plan_id, status(active|paused|churned),
                branding jsonb (logo_url, accent_hex),  -- Phase 3 white label
                created_at

profiles        id -> auth.users, display_name, avatar_initials, theme_pref

memberships     user_id, tenant_id, role(owner|member), created_at
                -- drives the tenant switcher

plans           id, name(starter|growth|scale), monthly_price_cents,
                included_minutes, overage_cents_per_min, stripe_price_ids jsonb

voice_agents    id, tenant_id, retell_agent_id, name, phone_number, voice_desc,
                languages text[], business_hours jsonb, after_hours_behavior,
                escalation_number, qualification_questions text[],
                status(live|paused), crm_connection jsonb, recording_retention_months

calls           id, tenant_id, voice_agent_id, retell_call_id UNIQUE,
                caller_name, caller_phone, started_at, duration_seconds,
                outcome(inquiry_captured|quote_requested|voicemail|not_a_fit),
                recording_path, transcript jsonb [{speaker, text, ts}],
                analysis jsonb (destination, dates, party_size, budget, occasion, notes),
                created_at

leads           id, tenant_id, call_id nullable, name, summary,
                stage(new_inquiry|quoted|booked|traveling),
                details jsonb, tags text[], assigned_to nullable,
                position int, created_at, updated_at

usage_periods   id, tenant_id, period_start, period_end,
                minutes_used numeric, stripe_reported_at

invoices        id, tenant_id, stripe_invoice_id, number, period_label,
                minutes numeric, amount_cents, status(paid|open|void), pdf_url

change_requests id, tenant_id, user_id, message, status(open|done), created_at

audit_log       id, tenant_id, actor_user_id, action, payload jsonb, created_at
```

Indexes to create on day one: `calls(tenant_id, started_at desc)`, `leads(tenant_id, stage, position)`, `calls(retell_call_id)` unique, `memberships(user_id)`.

---

## 6. Feature specification

The prototype demonstrates every screen. Match its layout and behaviour. This section adds the contracts and rules the prototype fakes.

### 6.1 Authentication and tenancy (Phase 1)
- Email and password login, password reset, session persistence. Magic link optional.
- After login: one tenant goes straight to its dashboard, several go to the last used tenant, switchable from the sidebar switcher.
- The switcher lists tenants from `memberships`. "Add agency account" is admin only and hidden for clients in v1.
- **Acceptance:** a user cannot read or mutate another tenant's rows. Enforced in the database, not just the UI. Ship an automated test that proves a cross-tenant read fails.

### 6.2 Overview (Phase 1)
- Four KPI cards with sparklines: Calls handled, Trip inquiries, Average handle time, Minutes used against plan quota. Each computed for the selected range against the previous equal-length range.
- Call volume bars, peak day highlighted, value labels above each bar.
- Outcomes: a segmented proportion bar plus a list with counts and percentages. Colours: inquiry positive green, quote accent teal, voicemail muted, not-a-fit negative red.
- Recent calls: the four newest rows, same component as the Calls tab.
- Date range: fixed "Last 7 days" in Phase 1, selectable 7/30/90 in Phase 2. The control is already styled as a dropdown.
- Status pill reflects `voice_agents.status`.

### 6.3 Calls (Phase 1)
- Paginated list, newest first. Filter chips with live counts: All, Inquiries, Quotes, Voicemail, Not a fit, mapped to `outcome`.
- Row: caller name or "Unknown Caller", timestamp, outcome badge, duration, coloured mini waveform tinted by outcome.
- Expanding a row reveals the audio player (real HTML5 playback against a short-lived signed URL), the speaker-labelled transcript, and the **trip brief block** with destination, dates, party, budget and occasion plus a link through to the lead.
- Only one row open at a time. Per-filter empty state.
- Search by caller name or phone: Phase 2.

### 6.4 Trip pipeline (Phase 1 read and move, Phase 2 full CRUD)
- Kanban: New inquiry, Quoted, Booked, Traveling, with coloured stage dots and counts.
- Cards: name, summary line, tags. Created automatically from qualifying calls.
- Phase 1: drag and drop between stages, persisting `stage` and `position`. If drag and drop has to be cut for time, ship a stage dropdown on the card instead. Do not ship frozen cards.
- Phase 2: edit and delete, assign a consultant, add manual leads, per-stage trip value totals.

### 6.5 Billing (Phase 2, static plan data in Phase 1)
- Current plan card: plan name, included minutes, overage rate, usage bar from `usage_periods`.
- Next invoice card: upcoming Stripe amount, auto-bill date, base and overage split, "Update payment method" into the Stripe customer portal.
- Invoice history from `invoices`, synced by Stripe webhooks, PDF links.
- Wiring: each tenant is a Stripe customer, the subscription is base price plus metered overage price. Report usage on ingest or with a nightly job. Handle `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`. Payment failure emails the owner and shows a banner. Do not auto-pause the agent, pausing is a manual admin decision.

### 6.6 Agent setup (Phase 1, read only)
- Key and value view of `voice_agents`, exactly as prototyped, plus recording retention.
- "Request a change" opens a modal, writes a `change_requests` row and emails platform admins. Clients do not edit agent config directly in v1, a bad config breaks a live phone line. Keep it concierge and say so in the UI, as the prototype does.

### 6.7 Internal admin console (Phase 1, minimal)
- List and create tenants, attach Retell agent IDs and phone numbers, set plan, pause or resume an agent, work the change-request queue, "view as tenant" read-only impersonation with a visible banner.
- Plain and functional is fine. Protect by a role claim, platform admins flagged in a `platform_admins` table or auth metadata.

### 6.8 Marketing site (Phase 3, prototype view deployed until then)
- Until Phase 3, deploy the prototype's marketing view as the landing page with "Client login" pointing at the portal.
- Phase 3: rebuild in Next.js with a demo-request form writing to a table and emailing the team, SEO and OG tags, analytics.
- The floating Site / Login / Portal pill in the prototype is a development aid. Strip it from any build a client can reach.

### 6.9 Theming and white label
- Dark and light, defaulting to the system preference, persisted per user in `profiles.theme_pref` with a localStorage fallback.
- Every colour flows through the tokens in section 7. That token layer is also the white-label hook: Phase 3 swaps tenant logo and accent from `tenants.branding`.

---

## 7. Design system v2, "Deep Ink"

Ported directly from `Voxline-UI-Prototype.html`. Copy the values, do not re-invent them.

### 7.1 Typography

| Role | Family | Usage |
|---|---|---|
| UI and body | **Inter**, weights 400/450/500/600/700 | Everything by default. Body 15px, line height 1.6, letter-spacing -0.005em |
| Display accent | **Instrument Serif**, italic | One or two words inside a marketing headline, and the login quote. Never in the portal chrome |
| Micro labels, numbers, metadata | **JetBrains Mono**, 500 | KPI labels, timestamps, phone numbers, invoice IDs, plan codes, table headers. 10 to 11px, uppercase, letter-spacing 0.12em |

Headings use weight 600 and letter-spacing -0.028em. All figures use `font-variant-numeric: tabular-nums`. Body text never drops below 12px, and 12px is reserved for mono metadata.

### 7.2 Colour tokens

Dark is the base. Light is a full override, not an afterthought. No hex value appears anywhere outside the token block.

| Token | Dark | Light |
|---|---|---|
| `bg` | `#06090C` | `#F4F6F8` |
| `bg-2` | `#080C11` | `#FFFFFF` |
| `surface` | `#0C1116` | `#FFFFFF` |
| `surface-2` | `#111820` | `#F1F4F6` |
| `surface-3` | `#18212B` | `#E7ECEF` |
| `border` | `rgba(255,255,255,.07)` | `#E4E9ED` |
| `border-2` | `rgba(255,255,255,.13)` | `#D2DAE0` |
| `border-3` | `rgba(255,255,255,.22)` | `#B9C4CC` |
| `text` | `#EDF2F5` | `#070D12` |
| `text-2` | `#AEBCC6` | `#3B4954` |
| `muted` | `#77848F` | `#66737D` |
| `faint` | `#4B5761` | `#93A0A9` |
| `accent` | `#14E0C0` | `#07836F` |
| `accent-2` | `#63E6FF` | `#0C7490` |
| `accent-ink` (text on accent) | `#03120F` | `#FFFFFF` |
| `accent-text` | `#5FEDD6` | `#066A5A` |
| `positive` | `#3BD68B` | `#0B7A50` |
| `warning` | `#F5C451` | `#9A6206` |
| `negative` | `#FF6E6E` | `#C0342E` |

**Accent discipline is the whole design.** The accent covers roughly five percent of the screen: primary buttons, the active nav marker, the peak bar, sparklines, the live dot, focus rings. Everything else is ink on near-black or near-white. If a screen starts to feel teal, remove accent, do not add more.

Contrast: every pair above clears WCAG AA at its intended size. `accent` on `bg` in dark is for large text and graphics only, small text on a teal fill uses `accent-ink`.

### 7.3 Geometry, elevation, motion

- Radii: `8 / 11 / 14 / 20 / 28 / 999`. Cards 20px, buttons 11px, pills full.
- Spacing on an 8pt grid. Card padding 24px, page padding 28px, section rhythm 16 to 20px.
- Three shadows only, plus one accent glow for the primary button. Dark mode leans on borders and a one-pixel inner highlight rather than heavy shadow.
- Decoration: a fixed SVG grain overlay at low opacity, radial brand blooms behind the hero and login aside, a faint masked grid. These are what make it read premium. Keep them subtle enough that a screenshot at 50 percent looks flat and clean.
- Motion: 140 to 220ms, `cubic-bezier(.2,.7,.3,1)`. Hover lifts 1px, press settles to 0.985 scale. KPI values count up once on mount, the usage bar animates its width on entry. Nothing loops except the live pulse dot. Respect `prefers-reduced-motion` and drop transforms when it is set.

### 7.4 Brand system, the waveform motif

Voxline is a voice company, so the identity is a voice waveform used as a repeating system rather than a logo that sits in a corner. The same shape appears in six places, and nowhere else:

| Use | Implementation | Where |
|---|---|---|
| Mark | Five bars in a rounded square, brand gradient, inner white stroke at 22 percent | Nav, footer, login, sidebar, favicon |
| Wordmark | `VOXLINE`, uppercase, weight 600, letter-spacing 0.19em, 13px | Always beside the mark, never alone below 11.5px |
| Divider | `.wave-rule`, a masked repeating waveform with a gradient fade at both ends | Section transitions, above the closing call to action |
| Watermark | `.wm`, the waveform ghosted at 13 percent opacity into a card's bottom-right corner | The two wide bento cards, the login aside. Maximum one per viewport |
| Live indicator | `.wave-load`, five bars animating on a staggered delay | The portal status pill, the "answering now" card |
| Empty-state art | The same `.wave-load` inside the empty-state ring, at 35 percent opacity | Filtered call list with no results, empty pipeline column |

Rules: the motif is never stretched, never rotated, never filled with a colour other than the accent, and never used more than twice on one screen. If it starts to feel like decoration, remove one.

**Wordmark lockup:** mark and wordmark sit 11px apart, optically centred. The wordmark's tracking is what makes it read as a brand rather than a heading, so it does not change with size. On dark, the mark carries the gradient. On light, the same gradient in the light-mode accent pair.

### 7.5 Material

Surfaces are physical, not flat. Three layers combine on every card:

1. **Glass fill.** `--glass`, a top-to-bottom translucent white gradient over `--surface`. Dark uses 4.5 percent to 1.2 percent, light uses 90 percent to 35 percent white.
2. **Inner highlight.** `--inner-hl`, a one-pixel inset top edge so the card catches light.
3. **Gradient hairline.** A masked one-pixel border that is bright at the top edge and fades out by 40 percent down, drawn with `mask-composite: exclude`. This is what separates it from a normal bordered box.

The hero and login carry a **pointer-tracked spotlight**, a 520 by 340 radial in `--spot` that follows the cursor at requestAnimationFrame cadence and is disabled under `prefers-reduced-motion`. Keep it under 10 percent opacity. It should be felt, not seen.

Depth hierarchy, do not skip a step: page background, then `surface-2` for grouped containers such as kanban columns, then `surface` with glass for cards, then `surface-3` for controls inside cards, then the modal layer with the heaviest shadow.

### 7.6 Editorial typography

Instrument Serif is not decoration, it marks a change of voice.

| Context | Treatment |
|---|---|
| Marketing headline | Sans, with one or two words set in serif italic. Never a whole headline in serif |
| Quote band | Full serif, 24 to 34px fluid, with the key figure in accent italic |
| Portal card and panel titles | Serif, 19px for cards, 24px for panel titles. Everything else in the portal stays sans |
| Empty states and modals | Serif headline over sans body, which makes an empty screen feel authored |
| Lede paragraph | Optional serif drop cap in the accent, 3.1em, first paragraph of a section only |
| Data, labels, numbers | Never serif. Mono for labels, sans tabular for figures |

Tracking is tighter as size grows: h1 at -0.042em, h2 at -0.036em, h3 at -0.024em, h4 at -0.018em, body at -0.005em.

### 7.7 Layout density

The site is deliberately dense. Sections are 72px apart, not 120px. Every section head is a two-column split, title on the left and supporting sentence on the right, separated from the content by a hairline. A heading that leaves half the row empty is a bug, not a style.

### 7.8 Component inventory

Build these as typed React components with the same names, all present in the prototype:

`Logo` (mark + wordmark, sizes md, sm) · `WaveRule` · `WaveWatermark` · `WaveLoader` · `Spotlight` · `Button` (primary / ghost / quiet, sizes sm, md, lg) · `ThemeToggle` · `Badge` (neutral / ok / accent / warn / bad) · `Eyebrow` · `KpiCard` + `Sparkline` · `BarChart` · `OutcomeBars` · `FilterChips` · `CallRow` + `Transcript` + `AudioPlayer` + `TripBrief` · `KanbanColumn` + `LeadCard` · `TenantSwitcher` · `SidebarNav` · `Topbar` + `StatusPill` + `RangePicker` · `UserChip` · `DataTable` · `KeyValueList` · `UsageBar` · `Notice` · `EmptyState` · `Modal` · `CommandPalette` · `Toast` · `LoginCard`.

### 7.9 Interaction rules that are part of the design

- Focus is always visible: 2px accent outline, 2px offset. Never remove it.
- Every destructive or irreversible action asks first. Every asynchronous action produces a toast.
- Every list has an empty state with a real sentence, never a blank panel.
- Every number that can be zero renders correctly at zero, including the charts.
- The command palette (Cmd or Ctrl + K) is the keyboard path to every tab and to tenant switching. Cmd or Ctrl + J toggles the theme. Escape closes any overlay.
- Responsive: sidebar collapses to a horizontal tab strip under 1000px, KPI grid to two columns under 1100px and one under 560px, kanban to two columns then one. Nothing scrolls horizontally except a table inside its own container.

---

## 8. Non-functional requirements

- **Tenant isolation.** RLS on every tenant table, with an automated cross-tenant access test running in CI. This is the single most important requirement in the project. A feature that ships without it is not shipped.
- **Security.** Verify webhook signatures for both Retell and Stripe. Recordings live in a private bucket, served through short-lived signed URLs. No service-role key in any client bundle. Rate-limit auth endpoints. No secrets in the repo, ever.
- **Privacy.** Calls contain personal data. Per-tenant deletion path for GDPR, configurable recording retention with a 12-month default, and a per-tenant switch to disable recording storage entirely. Call-recording consent is the agency's responsibility, the platform has to support them meeting it. Decide EU or US data residency before the first pilot goes live.
- **Reliability.** Webhook handlers idempotent and logged. A missed webhook is recoverable through a nightly reconciliation job that pulls recent calls from the Retell API.
- **Performance.** Dashboard interactive in under 2 seconds at realistic volume, thousands of calls. Paginate calls. Pre-aggregate daily stats if read-time aggregation gets slow, computing on read is fine in Phase 1.
- **Quality.** TypeScript strict, no `any` in application code. Playwright end-to-end tests on the critical paths: login to dashboard, expand a call, move a pipeline stage, cross-tenant denial. CI green on every pull request.
- **Accessibility.** WCAG AA contrast, keyboard reachable controls, labelled form fields, `prefers-reduced-motion` respected.

---

## 9. Delivery plan, ten working days

**Window:** Monday 24 August to Friday 4 September 2026. Hard stop. Scope is Phase 1 plus four Phase 2 items pulled forward, because without billing and notifications this is a dashboard rather than a productised service.

The plan only holds under four conditions. If any of them breaks, cut scope rather than moving the date.

1. The day-zero kit exists before day one: repo scaffolded with Next.js, TypeScript strict, Tailwind with the tokens mapped, Supabase clients, Sentry, CI and Vercel previews.
2. The three risky backend tickets run on a senior track, not the intern's: S-1 schema and RLS, S-2 Retell ingestion, S-3 Stripe billing. About four senior days across the two weeks.
3. Pull requests are reviewed within four working hours and merged the same day.
4. Nothing is designed during the build. Every screen already exists in the prototype.

### Track A, the build (Adnan)

| Day | Ships |
|---|---|
| 1 Mon | Design tokens into Tailwind, primitives and brand components, kitchen-sink route in both themes |
| 2 Tue | Login against Supabase Auth, protected routes, tenant resolution, switcher, sidebar, topbar, mobile tabs, command palette |
| 3 Wed | Overview: KPI cards with sparklines and deltas, call volume, outcome breakdown, recent calls |
| 4 Thu | Calls: paginated list, filter chips with counts, expand and collapse, speaker-labelled transcript, empty states |
| 5 Fri | Calls: real audio playback from signed URLs, trip-brief block, link to lead. **Demo 1** |
| 6 Mon | Trip pipeline with drag and drop persisting stage and position. **Phase 2: date range selector 7 / 30 / 90** |
| 7 Tue | Agent setup read-only, change-request modal. **Phase 2: new-inquiry email within a minute** |
| 8 Wed | Billing and usage against real Stripe data, customer portal redirect, invoice history, payment-failure banner |
| 9 Thu | Admin console, marketing landing page deployed. **Phase 2: daily digest email at 7am** |
| 10 Fri | Playwright suite, isolation test, Sentry, README, bug bash, pilot cutover. **Demo 2**. Buffer if week one slipped |

### Track B, the senior track (Khush or Vineet)

| Ticket | Days | Scope |
|---|---|---|
| S-1 | 1 to 2 | Schema, RLS policies on every tenant table, seed script for the two demo tenants, cross-tenant isolation test in CI |
| S-2 | 2 to 4 | Retell webhook ingestion, signature verification, idempotent upsert on `retell_call_id`, auto lead creation, minute counting, nightly reconciliation job |
| S-3 | 6 to 7 | Stripe subscription with metered overage, usage reporting, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.updated` handlers |

### Phase 2 items pulled into the two weeks

Billing live on Stripe with the hosted customer portal · date range selector · new-inquiry email · daily digest email.

### Deferred, and why it is safe to defer

CRM sync · member seats and invites · manual lead creation, editing and assignment · call search · self-serve plan upgrades · white label (logo, accent, subdomain) · CSV export · cross-tenant admin analytics · a rebuilt marketing site. None of these block a pilot, and all of them are cheaper to build after watching two real agencies use the product for a month.

### If the schedule slips, cut in this order

1. Drag and drop on the pipeline, replaced by a stage dropdown.
2. The daily digest email.
3. The 30 and 90 day ranges, keeping the fixed 7 day view.
4. Admin console polish, with onboarding done by SQL snippet for the first agencies.
5. The command palette.

**Never cut:** row-level security and the isolation test, webhook signature verification, private recordings behind signed URLs, both themes working. If those are on the table, move the date instead.

### Exit criteria, Friday 4 September

A real call placed to a newly onboarded agency appears in that agency's portal within 60 seconds with transcript, playable recording and trip brief; the new-inquiry email arrives; its minutes appear on the usage bar; a lead can be dragged between stages and stays there; the second tenant can see none of it, in the UI or through the API; and all of it works on a phone in dark mode.

## 10. Out of scope for v1

Outbound calling campaigns · our own telephony or voice stack · native mobile apps, the portal is responsive instead · client-side agent prompt editing · a multi-language portal UI, the agents speak many languages but the portal is English · SOC 2 certification, design with it in mind and certify later.

---

## 11. Decisions made, and what is still open

Answered since v1:

1. **Retell account structure:** one Retell workspace, one agent per tenant. Webhook routing resolves the tenant from the Retell agent ID.
2. **Overage policy:** keep answering and bill the overage. Never silently drop a caller. This matches the marketing copy.
3. **Brand:** Voxline is a standalone product brand. Oltaflock appears as "A product of Oltaflock AI LLP" in the footer and in legal documents, nowhere else.
4. **Design direction:** Deep Ink, dark first, as specified in section 7.

Still open, and needed before the phase in brackets:

1. First CRM to support, HubSpot assumed. Confirm against the pilot clients. [Phase 2]
2. EU or US data residency for the Supabase project. This one is hard to reverse, decide before the first production tenant. [Phase 1]
3. Custom domain per tenant at Phase 3 launch, or is a path such as `voxline.io/blueharbor` acceptable initially. [Phase 3]
4. Do we let agency members see billing in read-only, or hide it entirely. [Phase 2]

---

## 12. Files in this handover

| File | What it is |
|---|---|
| `Voxline-UI-Prototype.html` | The prototype. Design source of truth. Open it in a browser, click through all three views in both themes before writing any code |
| `Voxline-Spec.md` | This document |
| `Voxline-Build-Handbook.pdf` | The handbook Adnan works from: purpose, architecture, every screen with a screenshot, design system, the ten day plan, security rules |
| `_superseded/` | v1 spec and prototype, the naming exploration, and the old SOP. Kept for history only. Do not build from these |
