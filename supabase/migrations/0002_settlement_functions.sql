-- 0002_settlement_functions.sql
--
-- M5. The functions of docs/DATA_MODEL.md §4. Every one is `security definer`
-- with `search_path = ''` (so an unqualified name can never be resolved against
-- a caller-controlled schema) and is revoked from `public`, `anon`, and
-- `authenticated`. Only the secret key — whose `service_role` bypasses RLS —
-- may execute them.
--
-- Content lives in the repository, not in the database (docs/DATA_MODEL.md
-- §3.3). These functions therefore never decide *what* an unlock grants or
-- *how many points* an item is worth: the server computes both from
-- @carry-or-fall/game-content and passes them in. The database's job is
-- atomicity and exactly-once, not game rules.

-- ---------------------------------------------------------------------------
-- ensure_account — idempotent provisioning (docs/DATA_MODEL.md §4.1)
--
-- Deliberately not a trigger on auth.users: a trigger would need the default
-- unlock list to live in SQL, putting a second copy of content in the database.
-- The server passes the ids it read from game-content.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_account(
  p_user_id         uuid,
  p_display_name    text,
  p_default_unlocks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balances public.point_balances%rowtype;
begin
  insert into public.profiles (user_id, display_name)
  values (p_user_id, p_display_name)
  on conflict (user_id) do update set last_seen_at = now();

  insert into public.point_balances (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Defaults come from no match, so source_match_id stays null.
  insert into public.unlocks (user_id, unlock_id, unlock_type)
  select
    p_user_id,
    entry ->> 'unlock_id',
    entry ->> 'unlock_type'
  from jsonb_array_elements(p_default_unlocks) as entry
  on conflict (user_id, unlock_id) do nothing;

  select * into v_balances from public.point_balances where user_id = p_user_id;

  return jsonb_build_object(
    'user_id', p_user_id,
    'balances', jsonb_build_object(
      'force', v_balances.force,
      'precision', v_balances.precision,
      'motion', v_balances.motion,
      'guard', v_balances.guard,
      'signal', v_balances.signal
    ),
    'unlock_ids', coalesce(
      (select jsonb_agg(unlock_id order by unlock_id)
         from public.unlocks where user_id = p_user_id),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_secure_item — technical plan §14.3 step 2, docs/DATA_MODEL.md §4.2
--
-- Idempotent on the reservation key. The caller may only report the secure
-- action successful *after* this returns, which is the whole point: a crash
-- before it returns leaves the item in normal inventory, and a crash after it
-- returns leaves a `pending` row for recovery to finalize. There is no ordering
-- in which the player is told the item is safe and it is not.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_secure_item(
  p_reservation_key text,
  p_match_id        uuid,
  p_user_id         uuid,
  p_item_id         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.secure_reservations%rowtype;
begin
  insert into public.secure_reservations (match_id, user_id, item_id, reservation_key)
  values (p_match_id, p_user_id, p_item_id, p_reservation_key)
  on conflict (reservation_key) do nothing
  returning * into v_row;

  if not found then
    -- A separate statement, therefore a new snapshot under `read committed`:
    -- a concurrent inserter's row is visible here once it has committed.
    select * into v_row
      from public.secure_reservations
     where reservation_key = p_reservation_key;

    return jsonb_build_object(
      'reservation_id', v_row.reservation_id,
      'item_id', v_row.item_id,
      'status', v_row.status,
      'already_reserved', true
    );
  end if;

  return jsonb_build_object(
    'reservation_id', v_row.reservation_id,
    'item_id', v_row.item_id,
    'status', v_row.status,
    'already_reserved', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_secure_reservation — docs/DATA_MODEL.md §3.7
--
-- Reachable in one case: the write succeeded but by the time the simulation
-- applied it the source slot no longer held that item (discarded, or the player
-- died, during the write). Recording `cancelled` is what stops recovery from
-- later honoring a promise that was withdrawn before it was made.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_secure_reservation(p_reservation_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.secure_reservations
     set status = 'cancelled', settled_at = now()
   where reservation_key = p_reservation_key
     and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- list_pending_reservations — the read half of §14.3's recovery
--
-- Only a reader. Finalizing needs the item's point values, which are content in
-- the repository, so the *server* computes each payload and settles it through
-- settle_match_reward below — under the key derived from that reservation's own
-- match and user, which is the identical key the crashed match's own settlement
-- would have used. Whichever runs second finds the ledger row and awards
-- nothing.
--
-- p_exclude_match_id keeps the match the player is joining right now out of the
-- result, so a live reservation is never finalized underneath a running room.
-- ---------------------------------------------------------------------------
create or replace function public.list_pending_reservations(
  p_user_id          uuid,
  p_exclude_match_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'reservation_key', reservation_key,
        'match_id', match_id,
        'user_id', user_id,
        'item_id', item_id,
        'reserved_at', reserved_at
      )
      order by reserved_at
    ),
    '[]'::jsonb
  )
  from public.secure_reservations
  where user_id = p_user_id
    and status = 'pending'
    and (p_exclude_match_id is null or match_id <> p_exclude_match_id);
$$;

-- ---------------------------------------------------------------------------
-- settle_match_reward — technical plan §18.2, docs/DATA_MODEL.md §4.3
--
-- Atomically, in the order §18.2 gives:
--   1. verify the settlement key is unused
--   2. insert the reward ledger row
--   3. add the point balances
--   4. insert unlocks without duplication
--   5. insert or update the match result
--   6. return the new balances and unlocks
-- ...plus marking any pending secure reservation for this match settled.
--
-- If step 1 finds the key used, every remaining step is skipped and the stored
-- result is returned with already_settled = true. That is §18.2's "a repeated
-- request with the same settlement key returns the existing result instead of
-- awarding twice", and it is what lets the caller retry freely without knowing
-- whether its previous attempt landed.
--
-- Concurrency: two transactions with the same key race on the unique index. The
-- second blocks until the first commits, its `on conflict do nothing` inserts
-- nothing, and its subsequent select — a new statement, therefore a new snapshot
-- under `read committed` — sees the committed row. Neither can apply the balance
-- update twice.
--
-- Balances are added (`force = force + excluded.force`), never set to a value
-- the caller supplies as an absolute. A caller that passed a wrong total could
-- overstate one award; it could never overwrite the account's history.
-- ---------------------------------------------------------------------------
create or replace function public.settle_match_reward(
  p_settlement_key text,
  p_match_id       uuid,
  p_user_id        uuid,
  p_outcome        text,
  p_reward_payload jsonb,
  p_points         jsonb,
  p_unlocks        jsonb,
  p_started_at     timestamptz,
  p_ended_at       timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger_id      uuid;
  v_balances       public.point_balances%rowtype;
  v_already        boolean := false;
  v_stored_payload jsonb;
begin
  -- 1 + 2. The ledger insert *is* the exactly-once check.
  insert into public.reward_ledger (match_id, user_id, settlement_key, reward_payload)
  values (p_match_id, p_user_id, p_settlement_key, p_reward_payload)
  on conflict do nothing
  returning user_id into v_ledger_id;

  if not found then
    v_already := true;

    select reward_payload into v_stored_payload
      from public.reward_ledger
     where match_id = p_match_id and user_id = p_user_id;

    select * into v_balances from public.point_balances where user_id = p_user_id;

    return jsonb_build_object(
      'already_settled', true,
      'reward_payload', v_stored_payload,
      'balances', jsonb_build_object(
        'force', coalesce(v_balances.force, 0),
        'precision', coalesce(v_balances.precision, 0),
        'motion', coalesce(v_balances.motion, 0),
        'guard', coalesce(v_balances.guard, 0),
        'signal', coalesce(v_balances.signal, 0)
      ),
      'unlock_ids', coalesce(
        (select jsonb_agg(unlock_id order by unlock_id)
           from public.unlocks where user_id = p_user_id),
        '[]'::jsonb
      )
    );
  end if;

  -- 3. Add the point balances.
  insert into public.point_balances as balances (
    user_id, force, precision, motion, guard, signal, updated_at
  )
  values (
    p_user_id,
    coalesce((p_points ->> 'force')::bigint, 0),
    coalesce((p_points ->> 'precision')::bigint, 0),
    coalesce((p_points ->> 'motion')::bigint, 0),
    coalesce((p_points ->> 'guard')::bigint, 0),
    coalesce((p_points ->> 'signal')::bigint, 0),
    now()
  )
  on conflict (user_id) do update set
    force      = balances.force + excluded.force,
    precision  = balances.precision + excluded.precision,
    motion     = balances.motion + excluded.motion,
    guard      = balances.guard + excluded.guard,
    signal     = balances.signal + excluded.signal,
    updated_at = now();

  -- 4. Insert unlocks without duplication.
  insert into public.unlocks (user_id, unlock_id, unlock_type, source_match_id)
  select
    p_user_id,
    entry ->> 'unlock_id',
    entry ->> 'unlock_type',
    p_match_id
  from jsonb_array_elements(coalesce(p_unlocks, '[]'::jsonb)) as entry
  on conflict (user_id, unlock_id) do nothing;

  -- 5. Insert or update the match result.
  insert into public.match_results (
    match_id, user_id, outcome, started_at, ended_at,
    duration_seconds, extracted, reward_payload
  )
  values (
    p_match_id,
    p_user_id,
    p_outcome,
    p_started_at,
    p_ended_at,
    greatest(0, floor(extract(epoch from (p_ended_at - p_started_at)))::integer),
    p_outcome = 'extracted',
    p_reward_payload
  )
  on conflict (match_id, user_id) do update set
    outcome          = excluded.outcome,
    ended_at         = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    extracted        = excluded.extracted,
    reward_payload   = excluded.reward_payload;

  -- Mark this match's pending secure reservation consumed (technical plan
  -- §14.3: "settlement marks the reservation consumed").
  update public.secure_reservations
     set status = 'settled', settled_at = now(), reward_payload = p_reward_payload
   where match_id = p_match_id
     and user_id = p_user_id
     and status = 'pending';

  -- 6. Return the new balances and unlocks.
  select * into v_balances from public.point_balances where user_id = p_user_id;

  return jsonb_build_object(
    'already_settled', v_already,
    'reward_payload', p_reward_payload,
    'balances', jsonb_build_object(
      'force', v_balances.force,
      'precision', v_balances.precision,
      'motion', v_balances.motion,
      'guard', v_balances.guard,
      'signal', v_balances.signal
    ),
    'unlock_ids', coalesce(
      (select jsonb_agg(unlock_id order by unlock_id)
         from public.unlocks where user_id = p_user_id),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the secret key may execute any of these. A browser holding a publishable
-- key and a user JWT gets `authenticated`, which is revoked below; RLS then also
-- denies it every underlying table (0001). Two independent denials, on purpose.
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_account(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_secure_item(text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_secure_reservation(text)
  from public, anon, authenticated;
revoke all on function public.list_pending_reservations(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.settle_match_reward(
  text, uuid, uuid, text, jsonb, jsonb, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
