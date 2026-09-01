-- A null recording_path used to mean four different things: audio is still
-- being prepared, no audio should exist, retrieval failed, or the provider was
-- never queried. The UI cannot explain those honestly without explicit state.
alter table calls
  add column recording_status text not null default 'unavailable'
    check (recording_status in ('pending', 'ready', 'unavailable', 'failed')),
  add column recording_attempts integer not null default 0
    check (recording_attempts >= 0),
  add column recording_first_attempt_at timestamptz,
  add column recording_next_retry_at timestamptz,
  add column recording_last_error text;

update calls
set recording_status = 'ready'
where recording_path is not null;

-- Real Sarvam calls have a retrievable interaction id. Seed calls and provider
-- events that never offered a recording remain honestly "unavailable".
update calls
set recording_status = 'pending',
    recording_first_attempt_at = coalesce(recording_first_attempt_at, created_at),
    recording_next_retry_at = now()
where provider = 'sarvam'
  and provider_call_id not like 'seed\_%' escape '\'
  and recording_path is null;

create index calls_recording_retry_idx
  on calls (recording_next_retry_at)
  where recording_status = 'pending';
