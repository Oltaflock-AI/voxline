-- ============================================================================
-- Lead score — how promising a call is, not just what happened on it.
-- ============================================================================
--
-- `outcome` already records WHAT happened (inquiry captured, quote requested,
-- voicemail, not a fit). It says nothing about how good the enquiry was. An
-- agency looking at 169 calls, of which 54 are inquiries, still has to open
-- every one to work out who to ring back first. That is the gap this closes.
--
-- Borrowed from the Sarthak Singapore dashboard, which scores every lead 0–100
-- and bands it hot/warm/cold. Adapted rather than copied: theirs is outbound
-- construction sales, so their signals are dial attempts and answer rate. Ours
-- are the things that actually predict a bookable trip.
--
-- A STORED GENERATED COLUMN, deliberately, rather than a value written by the
-- ingestion code. Three reasons:
--   - one implementation. A score computed in TypeScript would leave every
--     seeded row unscored after `supabase db reset`, and a second copy of the
--     formula in seed.sql would drift from the first.
--   - it cannot go stale. If a later webhook fills in the trip brief, the score
--     recomputes on write. Application code would have to remember to.
--   - it is queryable and indexable, so "hot leads first" is an ORDER BY
--     rather than something sorted in the browser after fetching everything.
--
-- The formula is deliberately simple and explainable. An agency that cannot be
-- told WHY a lead scored 72 will not trust the number, so the UI reconstructs
-- the same three parts from the same columns and shows them.
--
--   outcome            up to 45   what the caller actually did
--   brief completeness up to 40   5 fields x 8 — how much we know about the trip
--   engagement         up to 15   1 point per 20s of talk time, capped
--                      -------
--                      100
--
-- Bands (in src/lib/score.ts, so the labels live with the UI):
--   hot 80+   warm 60–79   cold under 60
-- ============================================================================

alter table calls
  add column lead_score integer
  generated always as (
    least(
      100,
      -- What the caller did. A quote request is the strongest inbound signal
      -- available; a voicemail is barely a signal at all but not zero, because
      -- someone did ring.
      (case outcome
         when 'quote_requested'  then 45
         when 'inquiry_captured' then 30
         when 'voicemail'        then 5
         else 0
       end)
      -- How much of the trip brief the agent got. Each field is worth the same
      -- because any one of them missing is a call-back question.
      + (case when coalesce(analysis->>'destination', '') <> '' then 8 else 0 end)
      + (case when coalesce(analysis->>'dates', '')       <> '' then 8 else 0 end)
      + (case when coalesce(analysis->>'party_size', '')  <> '' then 8 else 0 end)
      + (case when coalesce(analysis->>'budget', '')      <> '' then 8 else 0 end)
      + (case when coalesce(analysis->>'occasion', '')    <> '' then 8 else 0 end)
      -- Engagement. Someone who stayed on the line for five minutes is worth
      -- more of the agency's time than someone who hung up at twenty seconds.
      -- Capped so a rambling call cannot outrank a complete brief.
      + least(15, coalesce(duration_seconds, 0) / 20)
    )
  ) stored;

-- "Show me the hottest leads first" is the whole point, so it gets an index
-- rather than being sorted in the browser after fetching every row.
create index calls_lead_score_idx on calls (tenant_id, lead_score desc);
