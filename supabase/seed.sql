-- ============================================================================
-- Voxline seed — development fixtures.
--
-- Mirrors the TENANTS fixture in docs/Voxline-UI-Prototype.html (line ~1419),
-- which says: "these shapes come from Supabase (see spec §5), so keep the
-- keys." So the portal we build renders the same data the prototype shows.
--
-- ****  DEVELOPMENT ONLY. NEVER RUN THIS AGAINST PRODUCTION.  ****
-- It creates users with a known password and truncates every table first.
-- ============================================================================

-- Outcome key mapping, prototype -> spec §5 enum:
--   qualified -> inquiry_captured
--   booked    -> quote_requested
--   voicemail -> voicemail
--   lost      -> not_a_fit

begin;

truncate table
  audit_log, change_requests, invoices, usage_periods,
  leads, calls, voice_agents, memberships, platform_admins,
  profiles, tenants, plans
restart identity cascade;

delete from auth.users where email like '%@voxline.test';

-- ---------------------------------------------------------------------------
-- Fixed UUIDs so the isolation test and the app can reference them by hand.
-- ---------------------------------------------------------------------------
--   tenant blueharbor  11111111-1111-1111-1111-111111111111
--   tenant wanderlux   22222222-2222-2222-2222-222222222222
--   user sofia (both)  aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
--   user marco (BH)    bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
--   user elena (WL)    cccccccc-cccc-cccc-cccc-cccccccccccc
--   user admin         dddddddd-dddd-dddd-dddd-dddddddddddd

-- ---------------------------------------------------------------------------
-- plans — NOT seeded here any more.
--
-- Moved to migrations/20260902090000_plans_reference_data.sql, because a
-- deployed database needs them and seeds never reach one. The tenants below
-- still reference the same three ids, which is why that migration fixes them
-- rather than generating new ones.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
insert into tenants (id, name, slug, initials, plan_id, status) values
  ('11111111-1111-1111-1111-111111111111', 'Blue Harbor Travel', 'blueharbor', 'BH',
   '99999999-0000-0000-0000-000000000002', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Wanderlux Journeys', 'wanderlux',  'WJ',
   '99999999-0000-0000-0000-000000000003', 'active'),
  -- A freshly-signed agency with NO voice agent and no calls, so the onboarding
  -- side of Agent Setup is reachable without deleting one of the demo
  -- agencies. Everything after onboarding — the intake form, the progress
  -- tracker, the admin queue — is only visible from a tenant in this state.
  ('33333333-3333-3333-3333-333333333333', 'Coastline Travel Co', 'coastline', 'CT',
   '99999999-0000-0000-0000-000000000001', 'active');

-- ---------------------------------------------------------------------------
-- auth users
--
-- Direct insert into auth.users is a seeding shortcut. Password is a throwaway
-- dev literal — these accounts exist only in a local/dev project.
--
-- THE EMPTY STRINGS ARE LOAD-BEARING. The token columns below are nullable in
-- the table, but GoTrue (the Go auth service) scans them into plain `string`
-- fields, which cannot hold NULL. Leave them out and every login fails with
--   Scan error on column "confirmation_token": converting NULL to string
-- returned as a generic 500, so the UI just says "wrong password" and you
-- spend an hour blaming bcrypt.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  crypt('voxline-dev-only', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  '', '', '', '', '', '', '', ''
from (values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'sofia@voxline.test', 'Sofia Marchetti'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'marco@voxline.test', 'Marco Rossi'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'elena@voxline.test', 'Elena Duarte'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'admin@voxline.test', 'Oltaflock Admin')
) as u(id, email, display_name);

-- Every user needs a matching identity row, or getUser() returns a user with
-- no identities and some auth flows refuse to run.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@voxline.test';

insert into profiles (id, display_name, avatar_initials, theme_pref) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sofia Marchetti', 'SM', 'system'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Marco Rossi',     'MR', 'system'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Elena Duarte',    'ED', 'system'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Oltaflock Admin', 'OA', 'system');

-- Sofia belongs to BOTH tenants — she is what the tenant switcher is for
-- (spec §2: "the switcher shows an agency group with two brands").
-- Marco and Elena belong to exactly one each: they are the isolation test.
insert into memberships (user_id, tenant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'member'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'member'),
  -- Listed LAST on purpose. getUserTenants() orders by membership created_at,
  -- and defaultTenantSlug() takes the first, so putting Coastline earlier would
  -- land Sofia on an empty agency every time she signs in.
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'owner');

insert into platform_admins (user_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd');

-- ---------------------------------------------------------------------------
-- voice_agents — the `config` arrays from the prototype
-- ---------------------------------------------------------------------------
-- One agency on each provider, on purpose. Blue Harbor runs the Sarvam agent
-- (the pilot); Wanderlux stays on Retell (the bake-off comparison). That makes
-- the provider-agnostic ingestion visible in the demo rather than theoretical,
-- and it means both webhook paths are exercised by the seed.
--
-- webhook_token is fixed here so the local test script has a stable URL. In
-- production it is generated per agent by the migration and never reused.
insert into voice_agents (
  id, tenant_id, provider, provider_agent_id, webhook_token,
  name, phone_number, voice_desc, languages,
  business_hours, after_hours_behavior, escalation_number,
  qualification_questions, status, crm_connection, recording_retention_months
) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'sarvam', 'agent_seed_blueharbor',
   'devtokenblueharbor00000000000000000000000000000000000000000000000',
   'Blue Harbor Trip Line', '+1 (305) 555-0122',
   'Bright and friendly, female', array['English','Spanish','French'],
   '{"days":"Mon-Sun","open":"07:00","close":"21:00","tz":"America/New_York"}'::jsonb,
   'Captures trip details, emails summary to consultants', '+1 (305) 555-0177',
   array['Destination','Travel dates','Party size','Budget','Occasion'],
   'live', '{"provider":"hubspot","status":"connected"}'::jsonb, 12),

  ('33333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'retell', 'agent_seed_wanderlux',
   'devtokenwanderlux00000000000000000000000000000000000000000000000',
   'Wanderlux Concierge Line', '+1 (212) 555-0180',
   'Calm and refined, female', array['English','French','Japanese','German'],
   '{"days":"Mon-Sun","open":"00:00","close":"24:00","tz":"America/New_York"}'::jsonb,
   'Full service: captures inquiry and books consult calls', '+1 (212) 555-0195',
   array['Destination','Dates','Party size','Budget','Occasion','Past trips'],
   'live', '{"provider":"salesforce","status":"connected"}'::jsonb, 24);

-- ---------------------------------------------------------------------------
-- calls — the six detailed ones per tenant, transcripts verbatim from the
-- prototype so the Calls tab reads exactly as designed.
-- ---------------------------------------------------------------------------
insert into calls (
  id, tenant_id, voice_agent_id, provider_call_id, caller_name, caller_phone,
  started_at, duration_seconds, outcome, transcript, analysis
) values

-- ---- Blue Harbor -------------------------------------------------------
('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_001',
 'Amelie Fournier', '+1 (305) 555-0311',
 date_trunc('day', now()) + interval '16 hours 32 minutes', 318, 'inquiry_captured',
 '[{"speaker":"Agent","ts":0,"text":"Thanks for calling Blue Harbor Travel. Where are you dreaming of going?"},
   {"speaker":"Amelie","ts":7,"text":"We''re thinking Greece in late September, just the two of us."},
   {"speaker":"Agent","ts":15,"text":"Lovely time to go. What budget range should we plan around?"},
   {"speaker":"Amelie","ts":23,"text":"Around $6,000 total, flights included."},
   {"speaker":"Agent","ts":30,"text":"Perfect. Is this a special occasion, by any chance?"},
   {"speaker":"Amelie","ts":36,"text":"It''s our honeymoon."},
   {"speaker":"Agent","ts":41,"text":"Congratulations. I''ll flag this for our Mediterranean specialist and she''ll call you tomorrow morning."}]'::jsonb,
 '{"destination":"Greece","dates":"Late Sept","party_size":"2 travellers","budget":"~$6,000","occasion":"Honeymoon","notes":null}'::jsonb),

('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_002',
 'Jordan Blake', '+1 (305) 555-0288',
 date_trunc('day', now()) + interval '13 hours 7 minutes', 222, 'quote_requested',
 '[{"speaker":"Agent","ts":0,"text":"A seven-night Maldives package: overwater villa or beach villa?"},
   {"speaker":"Jordan","ts":6,"text":"Overwater if we can stretch to it."},
   {"speaker":"Agent","ts":12,"text":"I''ll have Sofia send you two options today. Email or phone?"},
   {"speaker":"Jordan","ts":19,"text":"Email works best."}]'::jsonb,
 '{"destination":"Maldives","dates":"7 nights, Nov","party_size":"2 travellers","budget":"$14,000","occasion":"Anniversary","notes":"Prefers email. Overwater villa."}'::jsonb),

('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_003',
 null, '+1 (786) 555-0904',
 date_trunc('day', now()) - interval '1 day' + interval '20 hours 11 minutes', 44, 'voicemail',
 '[{"speaker":"Agent","ts":0,"text":"You''ve reached Blue Harbor Travel after hours. Leave a message and we''ll call you back."},
   {"speaker":"Caller","ts":9,"text":"Hi, just checking on my Lisbon itinerary, call me tomorrow."}]'::jsonb,
 '{}'::jsonb),

('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_004',
 'The Okafor Family', '+1 (305) 555-0142',
 date_trunc('day', now()) - interval '1 day' + interval '14 hours 26 minutes', 411, 'inquiry_captured',
 '[{"speaker":"Agent","ts":0,"text":"Four travellers over spring break. Any destinations on the shortlist?"},
   {"speaker":"Okafor","ts":8,"text":"Costa Rica or Portugal, kid-friendly either way."},
   {"speaker":"Agent","ts":16,"text":"Both are excellent with children. What''s the budget range for the four of you?"},
   {"speaker":"Okafor","ts":25,"text":"Up to $12,000 all in."}]'::jsonb,
 '{"destination":"Costa Rica / Portugal","dates":"Spring break","party_size":"4 travellers","budget":"Up to $12,000","occasion":"Family","notes":"Kid-friendly required."}'::jsonb),

('44444444-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_005',
 'Nina Petrov', '+1 (305) 555-0166',
 date_trunc('day', now()) - interval '4 days' + interval '15 hours 40 minutes', 269, 'quote_requested',
 '[{"speaker":"Agent","ts":0,"text":"Cherry-blossom season books out fast. Are your dates flexible within April?"},
   {"speaker":"Nina","ts":8,"text":"Yes, flexible within April."},
   {"speaker":"Agent","ts":14,"text":"Great, I''ll ask Marco to prepare a quote today."}]'::jsonb,
 '{"destination":"Japan","dates":"April","party_size":"2 travellers","budget":"$9,500","occasion":"Cherry blossom","notes":"Dates flexible within April."}'::jsonb),

('44444444-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
 '33333333-0000-0000-0000-000000000001', 'seed_bh_006',
 'Sam Reid', '+1 (954) 555-0733',
 date_trunc('day', now()) - interval '4 days' + interval '10 hours 12 minutes', 63, 'not_a_fit',
 '[{"speaker":"Agent","ts":0,"text":"Are you looking to plan a trip with us today?"},
   {"speaker":"Sam","ts":5,"text":"No, I was trying to reach the airline directly."},
   {"speaker":"Agent","ts":11,"text":"No problem, I''ll give you their reservations line."}]'::jsonb,
 '{}'::jsonb),

-- ---- Wanderlux ---------------------------------------------------------
('55555555-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_001',
 'Celeste Marchand', '+1 (212) 555-0410',
 date_trunc('day', now()) + interval '17 hours 2 minutes', 434, 'inquiry_captured',
 '[{"speaker":"Agent","ts":0,"text":"Welcome to Wanderlux Journeys. How can I help you travel beautifully?"},
   {"speaker":"Celeste","ts":7,"text":"We''d like a private safari for our 25th anniversary. Botswana, maybe Namibia."},
   {"speaker":"Agent","ts":17,"text":"A wonderful occasion. What time of year, and how many travelling?"},
   {"speaker":"Celeste","ts":25,"text":"June next year, just the two of us. Budget around $40,000."},
   {"speaker":"Agent","ts":34,"text":"Noted. Elena designs our southern Africa itineraries, and she''ll call you within the day."}]'::jsonb,
 '{"destination":"Botswana safari","dates":"June 2027","party_size":"2 travellers","budget":"~$40,000","occasion":"25th anniversary","notes":"Namibia also of interest. Private safari."}'::jsonb),

('55555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_002',
 'Hiro Tanaka', '+1 (212) 555-0455',
 date_trunc('day', now()) + interval '11 hours 26 minutes', 295, 'quote_requested',
 '[{"speaker":"Agent","ts":0,"text":"An Antarctica expedition cruise in December. Cabin preference?"},
   {"speaker":"Hiro","ts":7,"text":"Balcony if available. Please include the fly-cruise option too."},
   {"speaker":"Agent","ts":15,"text":"I''ll have Elena prepare both."}]'::jsonb,
 '{"destination":"Antarctica","dates":"December","party_size":"2 travellers","budget":"$28,000","occasion":"Bucket list","notes":"Balcony cabin. Wants fly-cruise option quoted too."}'::jsonb),

('55555555-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_003',
 null, '+1 (917) 555-0621',
 date_trunc('day', now()) + interval '7 hours 48 minutes', 52, 'voicemail',
 '[{"speaker":"Agent","ts":0,"text":"You''ve reached Wanderlux Journeys before opening hours. Please leave a message."},
   {"speaker":"Caller","ts":8,"text":"Morning, following up on the Patagonia itinerary, ring me back."}]'::jsonb,
 '{}'::jsonb),

('55555555-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_004',
 'The Whitmore Party', '+1 (212) 555-0388',
 date_trunc('day', now()) - interval '1 day' + interval '16 hours 15 minutes', 483, 'inquiry_captured',
 '[{"speaker":"Agent","ts":0,"text":"A multigenerational villa trip for nine. Tuscany or Provence?"},
   {"speaker":"Whitmore","ts":8,"text":"Tuscany. Two weeks in July, with a chef if possible."},
   {"speaker":"Agent","ts":17,"text":"Very doable. I''ll capture that and Theo will send villa options."}]'::jsonb,
 '{"destination":"Tuscany","dates":"July, 2 weeks","party_size":"9 travellers","budget":"$60,000","occasion":"Multigenerational","notes":"Private chef requested."}'::jsonb),

('55555555-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_005',
 'Priya Raman', '+1 (646) 555-0512',
 date_trunc('day', now()) - interval '1 day' + interval '13 hours 33 minutes', 201, 'quote_requested',
 '[{"speaker":"Agent","ts":0,"text":"Bhutan in festival season. Elena will send the full itinerary tonight."},
   {"speaker":"Priya","ts":8,"text":"Perfect, thank you."}]'::jsonb,
 '{"destination":"Bhutan","dates":"Festival season","party_size":"2 travellers","budget":"$18,000","occasion":"Milestone birthday","notes":null}'::jsonb),

('55555555-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222',
 '33333333-0000-0000-0000-000000000002', 'seed_wl_006',
 'Gene Ford', '+1 (718) 555-0199',
 date_trunc('day', now()) - interval '4 days' + interval '9 hours 20 minutes', 78, 'not_a_fit',
 '[{"speaker":"Agent","ts":0,"text":"What kind of journey can we design for you?"},
   {"speaker":"Gene","ts":5,"text":"Oh, I think I have the wrong number, sorry."}]'::jsonb,
 '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- Filler calls.
--
-- The prototype's KPI cards claim 96 calls for Blue Harbor and 241 for
-- Wanderlux, split across the four outcomes. Twelve seeded rows would make
-- every KPI read "6", so we top up to the real counts with transcript-less
-- rows. Three deliberate choices here:
--
--  1. CURRENT PERIOD IS DAYS 1-6, NOT 0-6. Nothing filler lands on today, so
--     the newest rows are always the hand-written ones with real transcripts.
--     Otherwise "Recent calls" on the Overview fills up with "Seed Caller 23"
--     and there is nothing interesting to expand.
--
--  2. THERE IS A PREVIOUS PERIOD TOO (days 7-13), at ~80% of current volume.
--     Spec §6.2 wants every KPI compared against "the previous equal-length
--     range". With only 7 days of data every delta reads "new", which tells
--     you nothing and hides bugs in the comparison maths. 80% gives a roughly
--     +20% week, close to the prototype's "+21%".
--
--  3. The counts still add up to 96 and 241 inside the 7-day window, so the
--     KPI cards match the prototype exactly.
--
-- This also matters for a reason beyond looks: a few hundred rows is the only
-- way to find out whether computing the KPIs on read (concept #6) holds up.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
  o record;
  i int;
  n_prev int;
begin
  for t in
    select * from (values
      ('11111111-1111-1111-1111-111111111111'::uuid, '33333333-0000-0000-0000-000000000001'::uuid, 'bh', 27, 15, 21, 27),
      ('22222222-2222-2222-2222-222222222222'::uuid, '33333333-0000-0000-0000-000000000002'::uuid, 'wl', 62, 39, 56, 78)
    ) as v(tenant_id, agent_id, prefix, n_inquiry, n_quote, n_voicemail, n_notfit)
  loop
    for o in
      select * from (values
        ('inquiry_captured'::call_outcome, t.n_inquiry,   180, 420),
        ('quote_requested'::call_outcome,  t.n_quote,     150, 380),
        ('voicemail'::call_outcome,        t.n_voicemail,  20,  70),
        ('not_a_fit'::call_outcome,        t.n_notfit,     30, 110)
      ) as v(outcome, n, min_dur, max_dur)
    loop
      -- current period: spread across days 1-6
      for i in 1..o.n loop
        insert into calls (
          tenant_id, voice_agent_id, provider_call_id, caller_name, caller_phone,
          started_at, duration_seconds, outcome, transcript, analysis
        ) values (
          t.tenant_id, t.agent_id,
          format('seed_%s_fill_%s_%s', t.prefix, o.outcome, i),
          case when o.outcome = 'voicemail' then null else 'Seed Caller ' || i end,
          '+1 (555) 555-' || lpad((1000 + i)::text, 4, '0'),
          date_trunc('day', now())
            - ((1 + floor(random() * 6))::int * interval '1 day')
            + (8 + floor(random() * 12)::int) * interval '1 hour'
            + floor(random() * 60)::int * interval '1 minute',
          o.min_dur + floor(random() * (o.max_dur - o.min_dur))::int,
          o.outcome, '[]'::jsonb, '{}'::jsonb
        );
      end loop;

      -- previous period: days 7-13, ~80% of the volume, so deltas are real
      n_prev := round(o.n * 0.8);
      for i in 1..n_prev loop
        insert into calls (
          tenant_id, voice_agent_id, provider_call_id, caller_name, caller_phone,
          started_at, duration_seconds, outcome, transcript, analysis
        ) values (
          t.tenant_id, t.agent_id,
          format('seed_%s_prev_%s_%s', t.prefix, o.outcome, i),
          case when o.outcome = 'voicemail' then null else 'Seed Caller ' || i end,
          '+1 (555) 555-' || lpad((2000 + i)::text, 4, '0'),
          date_trunc('day', now())
            - ((7 + floor(random() * 7))::int * interval '1 day')
            + (8 + floor(random() * 12)::int) * interval '1 hour'
            + floor(random() * 60)::int * interval '1 minute',
          o.min_dur + floor(random() * (o.max_dur - o.min_dur))::int,
          o.outcome, '[]'::jsonb, '{}'::jsonb
        );
      end loop;
    end loop;
  end loop;
end $$;

-- Keep every call's provider consistent with the agent that handled it, rather
-- than repeating it on every insert above. calls.provider is part of the
-- idempotency key (provider, provider_call_id), so it must be right.
update calls c
   set provider = va.provider
  from voice_agents va
 where va.id = c.voice_agent_id;

-- ---------------------------------------------------------------------------
-- leads — the pipeline cards, verbatim from the prototype.
-- stage index in the prototype: 0 new_inquiry, 1 quoted, 2 booked, 3 traveling
-- ---------------------------------------------------------------------------
insert into leads (tenant_id, call_id, name, summary, stage, tags, position) values
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001',
   'Amelie Fournier',   'Greece · Late Sept · 2 pax · ~$6,000',              'new_inquiry', array['Inbound call','Honeymoon'], 0),
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000004',
   'The Okafor Family', 'Costa Rica or Portugal · Spring break · 4 pax',     'new_inquiry', array['Inbound call','Family'],    1),
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000002',
   'Jordan Blake',      'Maldives · 7 nights · Overwater villa',             'quoted',      array['Sofia'],                    0),
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000005',
   'Nina Petrov',       'Japan · April · 2 pax · $9,500',                    'quoted',      array['Marco'],                    1),
  ('11111111-1111-1111-1111-111111111111', null,
   'Liam Chen',         'Iceland · Aug 22–29 · Deposit paid',                'booked',      array['Sofia'],                    0),
  ('11111111-1111-1111-1111-111111111111', null,
   'Rosa Delgado',      'Amalfi Coast · Returns Aug 9',                      'traveling',   array['Check-in scheduled'],       0),

  ('22222222-2222-2222-2222-222222222222', '55555555-0000-0000-0000-000000000001',
   'Celeste Marchand',  'Botswana safari · June · 2 pax · ~$40,000',         'new_inquiry', array['Anniversary','VIP'],        0),
  ('22222222-2222-2222-2222-222222222222', '55555555-0000-0000-0000-000000000004',
   'The Whitmore Party','Tuscany villa · July · 9 pax · Chef',               'new_inquiry', array['Multigen'],                 1),
  ('22222222-2222-2222-2222-222222222222', '55555555-0000-0000-0000-000000000002',
   'Hiro Tanaka',       'Antarctica cruise · Dec · Fly-cruise option',       'quoted',      array['Elena'],                    0),
  ('22222222-2222-2222-2222-222222222222', '55555555-0000-0000-0000-000000000005',
   'Priya Raman',       'Bhutan · Festival season · 2 pax',                  'quoted',      array['Elena'],                    1),
  ('22222222-2222-2222-2222-222222222222', null,
   'Marcus Webb',       'Galápagos yacht · Nov · 4 pax',                     'quoted',      array['Theo'],                     2),
  ('22222222-2222-2222-2222-222222222222', null,
   'The Ashfords',      'Kyoto & Tokyo · Oct 3–17 · Paid in full',           'booked',      array['Theo'],                     0),
  ('22222222-2222-2222-2222-222222222222', null,
   'Dana & Iris Kohl',  'Seychelles · Sept 12–22 · Deposit paid',            'booked',      array['Honeymoon'],                1),
  ('22222222-2222-2222-2222-222222222222', null,
   'The Larsen Family', 'Norwegian fjords · Returns Aug 11',                 'traveling',   array['Check-in scheduled'],       0);

-- ---------------------------------------------------------------------------
-- usage_periods — drives the usage bar on Billing
-- ---------------------------------------------------------------------------
insert into usage_periods (tenant_id, period_start, period_end, minutes_used) values
  ('11111111-1111-1111-1111-111111111111', date_trunc('month', now())::date,
   (date_trunc('month', now()) + interval '1 month - 1 day')::date, 1840),
  ('22222222-2222-2222-2222-222222222222', date_trunc('month', now())::date,
   (date_trunc('month', now()) + interval '1 month - 1 day')::date, 4380);

-- ---------------------------------------------------------------------------
-- invoices — history table on Billing
-- ---------------------------------------------------------------------------
insert into invoices (tenant_id, number, period_label, minutes, amount_cents, status) values
  ('11111111-1111-1111-1111-111111111111', 'INV-1042', 'Jul 2026', 2310,  49900, 'paid'),
  ('11111111-1111-1111-1111-111111111111', 'INV-1027', 'Jun 2026', 2680,  52520, 'paid'),
  ('11111111-1111-1111-1111-111111111111', 'INV-1011', 'May 2026', 1995,  49900, 'paid'),
  ('22222222-2222-2222-2222-222222222222', 'INV-1103', 'Jul 2026', 5820, 124000, 'paid'),
  ('22222222-2222-2222-2222-222222222222', 'INV-1088', 'Jun 2026', 6240, 126640, 'paid'),
  ('22222222-2222-2222-2222-222222222222', 'INV-1071', 'May 2026', 5410, 124000, 'paid');

-- ---------------------------------------------------------------------------
-- Trip briefs for the bulk-generated calls.
--
-- The generator above wrote '{}' for every filled call, so 590 of 598 calls
-- had no trip brief at all. That was invisible until lead scoring arrived and
-- reported almost everything as cold — correctly, given the data, but the data
-- was wrong: an agent that asks for destination and dates on every call does
-- not produce 590 empty briefs.
--
-- Completeness is varied on purpose rather than filled in everywhere. A real
-- agent gets the whole brief sometimes and half of it other times, and a score
-- that only ever returns one value would demonstrate nothing. Quote requests
-- skew complete (the caller stayed long enough to ask for a price); plain
-- inquiries skew partial.
-- ---------------------------------------------------------------------------
update calls set analysis = jsonb_strip_nulls(jsonb_build_object(
  'destination', (array['Kerala backwaters','Bali','Rajasthan heritage circuit',
                        'Andaman Islands','Swiss Alps','Vietnam and Cambodia',
                        'Ladakh','Maldives','Scotland highlands','Kyoto and Osaka'
                  ])[1 + floor(random() * 10)::int],
  'dates', (array['Late November','Mid December','Second week of March',
                  'Diwali week','Early February','Republic Day weekend',
                  'Summer holidays','First week of October'
            ])[1 + floor(random() * 8)::int],
  -- Party size is asked early, so it is present more often than budget.
  'party_size', case when random() < 0.80
      then (array['2 travellers','4 travellers','A family of 5','6 adults',
                  '2 adults and 2 children','A group of 8'
            ])[1 + floor(random() * 6)::int] end,
  -- Budget is the question callers most often dodge.
  'budget', case when random() < (case when outcome = 'quote_requested' then 0.75 else 0.40 end)
      then (array['Around ₹80,000','₹1.5–2 lakh','Under ₹1 lakh per couple',
                  '₹3 lakh all in','Flexible, wants options'
            ])[1 + floor(random() * 5)::int] end,
  'occasion', case when random() < (case when outcome = 'quote_requested' then 0.65 else 0.35 end)
      then (array['Honeymoon','Family holiday','Anniversary','First trip abroad',
                  'Milestone birthday','Work break'
            ])[1 + floor(random() * 6)::int] end
))
where outcome in ('inquiry_captured', 'quote_requested')
  and analysis = '{}'::jsonb;

commit;
