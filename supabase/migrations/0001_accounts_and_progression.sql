-- 0001_accounts_and_progression.sql
--
-- M5 (accounts and progression). Creates every table of docs/DATA_MODEL.md §3
-- and every row-level-security policy of §5.
--
-- Row-level security is enabled in the same statement block that creates each
-- table, never in a follow-up migration. This repository is public
-- (docs/DECISIONS.md D25) and a table that exists for even one deployment
-- without RLS is a table readable by every authenticated user of the project.
--
-- Nothing in this file contains a value from any environment: no keys, no URLs,
-- no project refs. Schema only.

-- ---------------------------------------------------------------------------
-- Helper: how many loadout preset slots the calling user may write.
--
-- Anonymous users authenticate with the *same* Postgres role as permanent users
-- (`authenticated`), so the role cannot distinguish them. The JWT's
-- `is_anonymous` claim can. `coalesce` is required because a permanent user's
-- token may omit the claim entirely rather than setting it false — and the
-- fallback deliberately points at "permanent", because guessing "anonymous"
-- would restrict linked accounts (docs/DATA_MODEL.md §2.1).
-- ---------------------------------------------------------------------------
create or replace function public.loadout_slot_allowance()
returns smallint
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 1::smallint
    else 3::smallint
  end
$$;

comment on function public.loadout_slot_allowance() is
  'Loadout preset slots the calling user may write: 1 when anonymous, 3 when permanent.';

-- ---------------------------------------------------------------------------
-- profiles (docs/DATA_MODEL.md §3.1)
--
-- `display_name` is server-generated (technical plan §17.1). There is no policy
-- letting a client write one, which makes §17.4's display-name filtering a
-- server concern with no client bypass.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  display_name text        not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status       text        not null default 'active'
                           check (status in ('active', 'restricted', 'deleted'))
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- point_balances (docs/DATA_MODEL.md §3.2)
--
-- The five categories of concept §6. Balances only ever increase: concept §6
-- describes no spending, shop, or refund mechanic, so unlocks are thresholds on
-- the accumulated balance rather than purchases (docs/DECISIONS.md D48). The
-- non-negative checks are a guard against a settlement bug, not a game rule.
-- ---------------------------------------------------------------------------
create table if not exists public.point_balances (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  force      bigint      not null default 0 check (force >= 0),
  precision  bigint      not null default 0 check (precision >= 0),
  motion     bigint      not null default 0 check (motion >= 0),
  guard      bigint      not null default 0 check (guard >= 0),
  signal     bigint      not null default 0 check (signal >= 0),
  updated_at timestamptz not null default now()
);

alter table public.point_balances enable row level security;

create policy "point_balances_select_own" on public.point_balances
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy exists. With RLS enabled and no permissive
-- policy, every such statement from a browser is denied — technical plan
-- §18.3's "players must not directly write" implemented as an absence rather
-- than as a rule that could be written wrong.

-- ---------------------------------------------------------------------------
-- unlocks (docs/DATA_MODEL.md §3.3)
--
-- `unlock_id` is a content id from @carry-or-fall/game-content. The database
-- holds no copy of the content table: what an unlock grants is versioned data
-- in the repository (docs/DECISIONS.md D34), and a row here means only "this
-- account has this id".
--
-- The composite primary key is what makes technical plan §18.2 step 4 —
-- "insert unlocks without duplication" — a database guarantee.
-- ---------------------------------------------------------------------------
create table if not exists public.unlocks (
  user_id         uuid        not null references auth.users (id) on delete cascade,
  unlock_id       text        not null,
  unlock_type     text        not null check (unlock_type in ('skill', 'weapon', 'armor')),
  unlocked_at     timestamptz not null default now(),
  -- Nullable because an account's default unlocks (concept §5.4) come from no
  -- match. Not a foreign key: match_results is keyed on (match_id, user_id), so
  -- a match id alone is not unique there.
  source_match_id uuid        null,
  primary key (user_id, unlock_id)
);

alter table public.unlocks enable row level security;

create policy "unlocks_select_own" on public.unlocks
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- loadouts (docs/DATA_MODEL.md §3.4)
--
-- The one client-writable table. A preset is a *preference*, not an
-- entitlement: the check below bounds the array's shape and length but
-- deliberately does not validate that the ids exist, are unique, or fit the
-- three-slot budget. That is createSkillLoadout's job on the server at join
-- (docs/DECISIONS.md D38, technical plan §19), which is what makes it safe to
-- let a browser write this table directly.
--
-- armor_id and movement_id are nullable because neither system exists yet
-- (concept §8.2, §8.4 are unimplemented in game-content). They are present
-- because technical plan §18.1 names them; no M5 code reads them.
-- ---------------------------------------------------------------------------
create table if not exists public.loadouts (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  slot_index  smallint    not null check (slot_index between 0 and 2),
  name        text        not null,
  weapon_id   text        not null,
  armor_id    text        null,
  skill_ids   jsonb       not null default '[]'::jsonb
                          check (
                            jsonb_typeof(skill_ids) = 'array'
                            and jsonb_array_length(skill_ids) <= 3
                          ),
  movement_id text        null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, slot_index)
);

alter table public.loadouts enable row level security;

-- `for all` covers select/insert/update/delete. `using` gates the rows a
-- statement may see or modify; `with check` gates the rows it may produce — both
-- are required, or a user could update their own row into another user's.
create policy "loadouts_write_own" on public.loadouts
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and slot_index < public.loadout_slot_allowance()
  )
  with check (
    user_id = (select auth.uid())
    and slot_index < public.loadout_slot_allowance()
  );

-- ---------------------------------------------------------------------------
-- match_results (docs/DATA_MODEL.md §3.5)
--
-- One row per player per match (concept §27.4). `match_id` is a server-generated
-- UUID, never the Colyseus room id and never accepted from a client.
--
-- 'abandoned' is in the outcome set because docs/DECISIONS.md D39 already
-- defines that state: a disconnected player whose reconnect window lapsed.
-- kills/pve_kills/boss_damage are written as 0 in M5 — there is no PvP damage
-- (D41), no boss (M7), and the simulation does not track PvE kills per player.
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (
  match_id         uuid        not null,
  user_id          uuid        not null references auth.users (id) on delete cascade,
  outcome          text        not null check (outcome in ('extracted', 'died', 'abandoned')),
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds integer     not null check (duration_seconds >= 0),
  kills            integer     not null default 0 check (kills >= 0),
  pve_kills        integer     not null default 0 check (pve_kills >= 0),
  boss_damage      integer     not null default 0 check (boss_damage >= 0),
  extracted        boolean     not null,
  reward_payload   jsonb       not null,
  primary key (match_id, user_id)
);

create index if not exists match_results_user_ended_idx
  on public.match_results (user_id, ended_at desc);

alter table public.match_results enable row level security;

create policy "match_results_select_own" on public.match_results
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- reward_ledger (docs/DATA_MODEL.md §3.6)
--
-- This table is the exactly-once guarantee. Two constraints that agree rather
-- than compete, because the settlement key is deterministic
-- ('{match_id}:{user_id}') rather than a random nonce: a server that dies after
-- computing a reward and before writing it recomputes the same key on recovery,
-- so the retry collides with the row that may already exist instead of creating
-- a second one.
--
-- No policy of any kind: a browser can neither read nor write it. Its effects
-- are visible in point_balances and unlocks; reading it would leak other
-- players' settlement timing.
-- ---------------------------------------------------------------------------
create table if not exists public.reward_ledger (
  match_id       uuid        not null,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  settlement_key text        not null unique,
  reward_payload jsonb       not null,
  settled_at     timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.reward_ledger enable row level security;

-- ---------------------------------------------------------------------------
-- secure_reservations (technical plan §14.3, docs/DATA_MODEL.md §3.7)
--
-- One row per secure-slot insertion. A player has one secure slot and a secured
-- item "cannot be removed during the run" (concept §7.2), so that is at most one
-- row per player per match — which is why reservation_key can be
-- '{match_id}:{user_id}' and its unique constraint means a replayed or retried
-- reservation cannot create a second row (docs/M5_ISSUES.md §1.8).
--
-- A 'pending' row surviving a server crash is exactly what §14.3's "the next
-- login or recovery job finalizes the protected reward" acts on.
-- ---------------------------------------------------------------------------
create table if not exists public.secure_reservations (
  reservation_id  uuid        primary key default gen_random_uuid(),
  match_id        uuid        not null,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  item_id         text        not null,
  reservation_key text        not null unique,
  status          text        not null default 'pending'
                              check (status in ('pending', 'settled', 'cancelled')),
  reserved_at     timestamptz not null default now(),
  settled_at      timestamptz null,
  reward_payload  jsonb       null
);

-- Recovery's access path: every pending reservation belonging to one user.
create index if not exists secure_reservations_pending_idx
  on public.secure_reservations (user_id)
  where status = 'pending';

alter table public.secure_reservations enable row level security;

-- No policy: server-only, like reward_ledger.
