-- ============================================================================
-- Real estate, part 2 of 2 — the vertical, and a lead score that branches on it.
-- ============================================================================
--
-- WHAT A VERTICAL IS HERE
--
-- Voxline was built for travel agencies. A second kind of agency — real estate —
-- asks different qualification questions, fills a different brief, and ends its
-- calls differently. A "vertical" is that whole bundle: which keys the brief
-- carries, which outcome is the win, and what a lead is worth.
--
-- IT BELONGS ON THE AGENT, NOT THE TENANT. One agency can run both. Sarthak
-- Singapore is the proof in the other direction: one client, three agents, and
-- they are not even the same asset class — two sell buildings, one sells land.
-- Putting the vertical on `tenants` would force a whole agency into one shape.
--
-- ...WHICH IS WHY IT IS ALSO COPIED ONTO `calls`, AND THAT NEEDS EXPLAINING.
--
-- Denormalising a column is normally a mistake. Here it is forced, by a rule
-- that has no way round it: a Postgres GENERATED column may reference ONLY the
-- current row. No subqueries, no joins. So `lead_score`, which is generated,
-- literally cannot look up `voice_agents.vertical` to decide which formula to
-- apply. The vertical has to already be on the row.
--
-- The alternative was to stop generating the score and compute it in
-- TypeScript at ingest. That was rejected when the score was first built and
-- the reasons still hold: one implementation instead of two, seeded rows score
-- themselves after a `db reset`, and the score recomputes for free when a
-- later webhook fills in the brief.
--
-- So: the webhook copies the agent's vertical onto the call, once, at ingest.
-- `calls.vertical` is a snapshot, not a foreign key — if an agent is later
-- switched from travel to real estate, old calls keep the vertical they were
-- actually scored under, which is the honest answer anyway.
--
-- ---------------------------------------------------------------------------
-- THE REAL-ESTATE FORMULA, AND WHERE ITS WEIGHTS COME FROM
-- ---------------------------------------------------------------------------
--
-- Same three parts as travel, same 45 / 40 / 15 split, so the portal can keep
-- one explanation component and one set of band boundaries. What changes is
-- what counts.
--
--   what the caller did        up to 45
--   brief completeness         up to 40   (5 fields x 8)
--   time on the call           up to 15   (1 per 20s)
--
-- The outcome weights are read off the qualification flow of Sarthak
-- Singapore's three live agents (analysed 2026-09-05, see
-- Sarthak_Singapore_Agents_Analysis.md in the workspace root):
--
--   site_visit_booked     45  the whole point of the call, and the only
--                             outcome with an external record behind it
--   transferred_to_human  35  asked about price or possession and agreed to be
--                             connected — a strong buying signal, one step
--                             short of a booking
--   quote_requested       30  a priced enquiry the agent could not answer. In
--                             real estate the agent is forbidden from quoting,
--                             so this is a genuine enquiry, not a near-close
--   inquiry_captured      30  qualified, no visit agreed
--   voicemail              5  same as travel
--   not_a_fit              0
--
-- The five brief fields mirror what those agents actually ask, plus the two
-- their CRM keeps even though the agent may not ask:
--
--   intent          self-use or investment       — asked on every call
--   property_type   residential / commercial / plot
--   unit_size       BHK count, sq ft, or plot size
--   timeline        when they want to move or register
--   budget          volunteered only; the agents are told never to discuss price
--
-- Expect `timeline` and `budget` to be sparse. That is not a flaw in the
-- formula: a caller who volunteers a budget to an agent that never asked has
-- told you something real, and 8 points is the right size for it.
--
-- `residency` (local vs NRI) is deliberately NOT scored. It is load-bearing for
-- Indian real estate and belongs in the brief, but it describes who the buyer
-- is, not how close they are to buying. Add it to `analysis` without scoring it.
--
-- ---------------------------------------------------------------------------
-- WHAT THE APPLICATION MUST DO TO HOLD UP ITS END
-- ---------------------------------------------------------------------------
--
--  1. `ingestCall()` writes `calls.vertical` from the agent's vertical.
--     Until it does, every call defaults to 'travel' and scores on the travel
--     formula — wrong, but not broken, and invisible in a travel-only account.
--
--  2. `src/lib/score.ts` grows the real-estate branch. It rebuilds this
--     arithmetic so the call detail page can show its working, and the two must
--     not drift. If the numbers above change, that file changes in the same
--     commit.
--
--  3. `OUTCOME_META` and `OUTCOME_ORDER` in `src/lib/outcomes.ts` are exhaustive
--     `Record<CallOutcome, …>` maps. The moment `database.types.ts` is
--     regenerated with the two new enum values, TypeScript will fail the build
--     until both are given labels. That failure is the feature: it is the
--     compiler refusing to render an outcome nobody has named.
--
--  4. `site_visit_booked` and `transferred_to_human` must be set from
--     PROVIDER-VERIFIED facts, never from an extraction field. A booking is a
--     booking id returned by the booking tool; a transfer is the provider
--     reporting that the transfer tool executed. An extraction field claiming
--     "site visit booked" fires on mere intent and on failed attempts alike —
--     Sarthak's dashboard learned this the expensive way and now scans tool
--     results instead. On Sarvam the clean route is to have the booking tool
--     write the id into an agent variable, so it arrives already verified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- the vertical itself
-- ---------------------------------------------------------------------------
create type agent_vertical as enum ('travel', 'real_estate');

alter table voice_agents
  add column vertical agent_vertical not null default 'travel';

comment on column voice_agents.vertical is
  'Which product this agent sells. Drives the brief keys, the outcome set and the lead-score formula. Per agent, not per tenant: one agency may run both.';

alter table calls
  add column vertical agent_vertical not null default 'travel';

comment on column calls.vertical is
  'Snapshot of the agent''s vertical at ingest. Denormalised because lead_score is a generated column and generated columns cannot read another table. Never back-fill from voice_agents after the fact: a call keeps the vertical it was scored under.';

-- Existing rows: every agent today is travel, so this changes nothing. Written
-- anyway, because a default is a statement about new rows and this is a
-- statement about old ones.
update calls c
   set vertical = a.vertical
  from voice_agents a
 where c.voice_agent_id = a.id
   and c.vertical is distinct from a.vertical;

-- ---------------------------------------------------------------------------
-- lead_score, rebuilt to branch on the vertical
-- ---------------------------------------------------------------------------
--
-- A generation expression cannot be altered, so this is drop-and-add. That
-- rewrites the table and takes the index with it — cheap at today's row count,
-- worth knowing before it is not. The index is recreated below; dropping it
-- explicitly first is not required but says out loud that it is going.
--
-- The travel branch is byte-for-byte the arithmetic from
-- 20260901090000_lead_score.sql. It is repeated rather than refactored into a
-- function: an IMMUTABLE function would work, but it would put the formula
-- somewhere a reader of this table's definition cannot see it, and the whole
-- point of the score is that it can be checked.

drop index if exists calls_lead_score_idx;

alter table calls drop column lead_score;

alter table calls
  add column lead_score integer
  generated always as (
    least(
      100,
      case vertical
        when 'real_estate' then
          (case outcome
             when 'site_visit_booked'    then 45
             when 'transferred_to_human' then 35
             when 'quote_requested'      then 30
             when 'inquiry_captured'     then 30
             when 'voicemail'            then 5
             else 0
           end)
          + (case when coalesce(analysis->>'intent', '')        <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'property_type', '') <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'unit_size', '')     <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'timeline', '')      <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'budget', '')        <> '' then 8 else 0 end)
          + least(15, coalesce(duration_seconds, 0) / 20)
        else
          (case outcome
             when 'quote_requested'  then 45
             when 'inquiry_captured' then 30
             when 'voicemail'        then 5
             else 0
           end)
          + (case when coalesce(analysis->>'destination', '') <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'dates', '')       <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'party_size', '')  <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'budget', '')       <> '' then 8 else 0 end)
          + (case when coalesce(analysis->>'occasion', '')    <> '' then 8 else 0 end)
          + least(15, coalesce(duration_seconds, 0) / 20)
      end
    )
  ) stored;

-- Recreated exactly as it was. "Hottest first" stays an ORDER BY rather than a
-- sort in the browser, which is the reason the score is a stored column at all.
create index calls_lead_score_idx on calls (tenant_id, lead_score desc);

-- Agents are looked up by vertical on the admin console and when picking which
-- brief component to render.
create index voice_agents_vertical_idx on voice_agents (tenant_id, vertical);
