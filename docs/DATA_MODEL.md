# Data Model

The persistent schema for **Carry or Fall**: Supabase Auth identities plus the PostgreSQL
tables, functions, and row-level security policies that hold permanent account progression.

`docs/DECISIONS.md` D22 deliberately deferred this document to M5, the milestone that
introduces persistence. It is written **before** the first migration and before any code that
reads or writes the schema, because the schema is the contract every other M5 change is built
against.

Authoritative sources: technical plan §18 (database design), §17 (accounts), §14.3 (secure-slot
persistence), §15.3 (settlement sequence), §19 (progression validation), §20.2 (environment
variables); concept §5 (permanent progression), §6 (point system), §7 (inventory and secure
slot).

---

## 1. What this database is, and what it must never become

`docs/DECISIONS.md` D9 says Supabase "must never hold live match state". This document draws
that boundary precisely, because M5 is the first milestone where the boundary can actually be
crossed.

**Live match state lives in the Colyseus room's memory and nowhere else.** Positions, health,
shields, cooldowns, projectiles, enemies, ground loot, extraction progress, the six-slot
inventory, the current tick — none of it is ever written to PostgreSQL, at any frequency, for
any reason. A 50 ms simulation step performs zero database calls.

The server writes to PostgreSQL at exactly **two** moments in a match's life:

| When | What is written | Why it cannot be deferred |
| --- | --- | --- |
| A player moves an item into the secure slot | one `secure_reservations` row | Technical plan §14.3: the write must land *before* the action is reported successful, so a server crash cannot invalidate the protection promise. |
| A player's run ends (death or extraction) | one `settle_match_reward()` call | Technical plan §15.3: the reward is written through one atomic operation, then marked settled. |

Both are **per-player, per-match, once**. A four-player match in which every player secures one
item and then ends their run performs eight writes in total, spread across twelve minutes.
Everything else the server needs — the account's unlocks, its loadout, its balances — is
**read** once, at join.

The rule stated as an invariant: *if the room crashed and the database were the only survivor,
it must be impossible to reconstruct where anyone was standing.* The database knows that a
player secured item `ancient_targeting_core` in match `…`, and later that they were awarded
points for it. It does not know the match happened in an arena, or who won.

---

## 2. Identity

Supabase Auth owns identity; this schema owns progression. Every table keys on
`auth.users.id` (a UUID) and cascades on delete, so removing an auth user removes their
progression with it.

### 2.1 Anonymous users are real users

Technical plan §17.1 requires instant guest play: the first visit calls
`signInAnonymously()`, which creates a **real row in `auth.users`** with
`is_anonymous = true`. Anonymous users authenticate with the Postgres role `authenticated`,
exactly like permanent users — the role does **not** distinguish them.

The distinction that does exist is a JWT claim: `is_anonymous`. Policies that need to treat the
two differently must read it:

```sql
coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
```

`coalesce` is required because a permanent user's JWT may omit the claim entirely rather than
setting it to `false`. Getting this wrong in the permissive direction (treating a missing claim
as anonymous) would restrict paying users; getting it wrong in the other direction (treating a
missing claim as permanent) would hand anonymous users the permanent-account surface. The
expression above fails toward "permanent", and §5.4's tests pin both directions.

### 2.2 Where the claim is used

Exactly one place: the number of **loadout preset slots** a user may write
(§3.4). Anonymous users own preset slot `0`; permanent users own slots `0`–`2`. Nothing about
gameplay, points, or unlocks depends on the claim — an anonymous account earns, keeps, and
spends progression identically. See `docs/DECISIONS.md` D47 for why the claim is attached to
this feature rather than to progression.

### 2.3 Linking

Technical plan §17.2: an anonymous account links to email, Google, or Discord. Linking is an
Auth-level operation (`updateUser`/`linkIdentity`) that **keeps the same `auth.users.id`**, so
no progression row moves, is copied, or is merged. That is the entire reason linking is safe:
the identity is stable and this schema never learns that it happened.

The corollary is §17.3's warning, and the reason it matters: an anonymous session that is lost
is lost with every row in this document still sitting in the database, unreachable, forever.
See §7.

---

## 3. Tables

All seven tables live in the `public` schema. **Row-level security is enabled on every one of
them in the same migration that creates them** (§5), never added later.

Column types follow technical plan §18.1. Where §18.1 gives a name and a type but no
constraint, the constraint below is stated here and is part of the contract.

### 3.1 `profiles`

```sql
user_id      uuid        primary key references auth.users(id) on delete cascade
display_name text        not null
created_at   timestamptz not null default now()
last_seen_at timestamptz not null default now()
status       text        not null default 'active'
                         check (status in ('active', 'restricted', 'deleted'))
```

One row per account, created by the server the first time it sees a user (§4.1).
`display_name` is **server-generated** (technical plan §17.1, "assign a generated display
name"): the client never supplies one and has no policy allowing it to write one, which makes
§17.4's display-name filtering a server-side concern with no client bypass.

`status` is the hook §17.4's abuse protection will use. M5 writes only `'active'`; the check
constraint exists so a later milestone cannot introduce a typo'd status silently.

### 3.2 `point_balances`

```sql
user_id    uuid        primary key references auth.users(id) on delete cascade
force      bigint      not null default 0 check (force     >= 0)
precision  bigint      not null default 0 check (precision >= 0)
motion     bigint      not null default 0 check (motion    >= 0)
guard      bigint      not null default 0 check (guard     >= 0)
signal     bigint      not null default 0 check (signal    >= 0)
updated_at timestamptz not null default now()
```

The five categories of concept §6, one row per account. `bigint` because these accumulate for
the life of an account and are never reset.

**Balances only ever increase.** Concept §6 describes points as "used to unlock or improve"
content and describes no spending, shop, or refund mechanic; introducing one would be inventing
a system neither authoritative document specifies. Unlocks are therefore **thresholds on the
accumulated balance** (§3.3), not purchases, and the `>= 0` checks are a guard against a
settlement bug rather than a business rule.

Note that `precision` is a reserved word in some SQL dialects but is a valid unquoted column
name in PostgreSQL. It is kept unquoted to match §18.1 literally.

### 3.3 `unlocks`

```sql
user_id         uuid        not null references auth.users(id) on delete cascade
unlock_id       text        not null
unlock_type     text        not null check (unlock_type in ('skill', 'weapon', 'armor'))
unlocked_at     timestamptz not null default now()
source_match_id uuid        null
primary key (user_id, unlock_id)
```

`unlock_id` is a **content id** from `@carry-or-fall/game-content` (for example
`stunning_blows`). The database deliberately holds no copy of the content table: what a given
unlock grants is data in the repository, versioned by `CONTENT_VERSION` (`docs/DECISIONS.md`
D34), not a row here. A row in this table means only "this account has this id".

The composite primary key is what makes §18.2's step 4 — "insert unlocks without duplication" —
a database guarantee rather than application diligence.

`source_match_id` is nullable because the **default** unlocks every account starts with
(concept §5.4) come from no match. It is not a foreign key: `match_results` is keyed on
`(match_id, user_id)` and a match id alone is not unique there.

**What M5 grants.** Two sources, both data-driven in `@carry-or-fall/game-content`:

1. **Defaults** — granted when the profile is created, so a fresh account can play the
   documented default loadout immediately (concept §5.4, `docs/DECISIONS.md` D31).
2. **Point thresholds** — granted at settlement when the *new* balance crosses a threshold
   (concept §6.1–§6.5, "used to unlock or improve"). The threshold table is content; see
   `docs/CONTENT_AUTHORING.md` §9.

Blueprint items (concept §19.2/§19.3) and boss skill cores (§19.4) are **not** M5 unlock
sources: no such loot exists in `@carry-or-fall/game-content`, and inventing it would be
gameplay content added by a persistence milestone. When M7 adds boss cores, they become a third
source writing to this same table with `source_match_id` set.

### 3.4 `loadouts`

```sql
user_id     uuid        not null references auth.users(id) on delete cascade
slot_index  smallint    not null check (slot_index between 0 and 2)
name        text        not null
weapon_id   text        not null
armor_id    text        null
skill_ids   jsonb       not null default '[]'::jsonb
                        check (jsonb_typeof(skill_ids) = 'array'
                               and jsonb_array_length(skill_ids) <= 3)
movement_id text        null
updated_at  timestamptz not null default now()
primary key (user_id, slot_index)
```

Loadout **presets** (concept §4.1 "optional loadout preset", §5.2). Three slots is the ceiling
the check enforces; how many a given user may write is the RLS policy's business (§5.3).

`armor_id` and `movement_id` are nullable because neither system exists yet: concept §8.2
(armor) and §8.4 (movement ability) are unimplemented in `@carry-or-fall/game-content`, which
ships weapons, skills, loot, one enemy, and one arena. The columns are present because §18.1
names them and because a nullable column costs nothing; they are **not** an empty service
layer, and no code reads them in M5.

`skill_ids` is the only column with real gameplay meaning in M5. Its check bounds the array
shape and length. It deliberately does **not** validate that the ids exist, are unique, or fit
the three-slot budget — that is `createSkillLoadout`'s job on the server at join
(`docs/DECISIONS.md` D38, technical plan §19). **This table stores a preference, not an
entitlement.** A client may write a preset naming a skill it has not unlocked; the server
refuses the join. That split is what makes it safe to let clients write this one table
directly (§5.3).

### 3.5 `match_results`

```sql
match_id         uuid        not null
user_id          uuid        not null references auth.users(id) on delete cascade
outcome          text        not null check (outcome in ('extracted', 'died', 'abandoned'))
started_at       timestamptz not null
ended_at         timestamptz not null
duration_seconds integer     not null check (duration_seconds >= 0)
kills            integer     not null default 0 check (kills >= 0)
pve_kills        integer     not null default 0 check (pve_kills >= 0)
boss_damage      integer     not null default 0 check (boss_damage >= 0)
extracted        boolean     not null
reward_payload   jsonb       not null
primary key (match_id, user_id)
```

One row per player per match (concept §27.4, "match result persistence"). `match_id` is a UUID
the **server** generates when the room is created; it is not the Colyseus room id, which is a
short non-unique string, and it is never accepted from a client.

`outcome` adds `'abandoned'` to §18.1's implied set, because `docs/DECISIONS.md` D39 already
defines that state: a disconnected player whose reconnect window lapses. M5 settles an
abandoned run through the crash-recovery path (§4.4) when it holds a secure reservation.

`kills` and `boss_damage` are written as `0` in M5: there is no PvP damage (`docs/DECISIONS.md`
D41) and no boss (M7). `pve_kills` is not tracked by the simulation either, and is likewise
`0`. They are stored because §18.1 names them; the alternative — omitting columns and migrating
them in later — is worse for a table whose primary key is already fixed.

### 3.6 `reward_ledger`

```sql
match_id       uuid        not null
user_id        uuid        not null references auth.users(id) on delete cascade
settlement_key text        not null unique
reward_payload jsonb       not null
settled_at     timestamptz not null default now()
primary key (match_id, user_id)
```

**This table is the exactly-once guarantee.** Every other duplicate-protection measure in the
system is a convenience; this one is the correctness boundary.

Two constraints, agreeing rather than competing:

- `primary key (match_id, user_id)` — a player settles a match once.
- `unique (settlement_key)` — a settlement key is consumed once.

They agree because the settlement key is **deterministic**: `'{match_id}:{user_id}'`, computed
by the server from values it already owns. It is not a random nonce and it is not generated at
call time. That matters for the crash case: a server that dies after computing a reward and
before writing it will, on recovery, compute the *same* key from the same match and user, so
the retry collides with the row that may already exist instead of creating a second one.

A random key would satisfy `unique(settlement_key)` on a retry and be caught only by the
primary key — which works, but leaves two constraints that disagree about what happened. A
deterministic key makes the two constraints describe the same fact.

### 3.7 `secure_reservations`

```sql
reservation_id  uuid        primary key default gen_random_uuid()
match_id        uuid        not null
user_id         uuid        not null references auth.users(id) on delete cascade
item_id         text        not null
reservation_key text        not null unique
status          text        not null default 'pending'
                            check (status in ('pending', 'settled', 'cancelled'))
reserved_at     timestamptz not null default now()
settled_at      timestamptz null
reward_payload  jsonb       null
```

Technical plan §14.3. One row per secure-slot insertion — and because a player has exactly one
secure slot and an item "cannot be removed during the run" (concept §7.2), that is **at most
one row per player per match**. `reservation_key` is therefore also deterministic:
`'{match_id}:{user_id}'`, the same shape as the settlement key, and its `unique` constraint
means a replayed or retried reservation cannot create a second row.

Status transitions, all of them:

```
             ┌── settled   (the run ended, or recovery finalized it)
pending ─────┤
             └── cancelled (the insertion never took effect)
```

`cancelled` is reachable in one case: the reservation write succeeded, but by the time the
simulation applied it the source slot no longer held that item (the player discarded it, or
died, during the write). The item is not awarded and the row records that the promise was
withdrawn before it was made — rather than leaving a `pending` row that recovery would later
honor for an item the player never actually secured.

`settled_at` and `reward_payload` are null while pending. A `pending` row surviving a server
crash is exactly what §14.3's "the next login or recovery job finalizes the protected reward"
acts on (§4.4).

### 3.8 `account_restrictions` — specified, not created

Technical plan §18.1 also names `account_restrictions` (`user_id`, `restriction_type`,
`reason`, `expires_at`, `created_at`). **M5 does not create it.** Nothing in M5 writes a
restriction, nothing reads one, and `docs/DEVELOPMENT_RULES.md` forbids creating empty layers
for features that do not exist yet. `profiles.status` already carries the one restriction
signal M5 could plausibly set, and it sets only `'active'`.

The table belongs to the milestone that implements §17.4 abuse protection — M8, where a public
internet test makes anonymous sign-in abuse a live concern (`docs/DECISIONS.md` D50). It is
recorded here so that milestone starts from a specification rather than an invention.

---

## 4. Writes

### 4.1 Profile provisioning (at join, not at sign-up)

The server calls `ensure_account(p_user_id, p_display_name, p_default_unlocks)` when it first
authenticates a user in a session. It is idempotent and, on a first call, creates:

- the `profiles` row,
- the `point_balances` row (all five categories at `0`),
- one `unlocks` row per default unlock id (concept §5.4).

Repeat calls update `last_seen_at` and nothing else. This is deliberately *not* an Auth trigger
on `auth.users`: a trigger would need the default unlock list to live in SQL, which would put a
second copy of content in the database and break §3.3's rule that content lives in the
repository. The server passes the ids it read from `@carry-or-fall/game-content`.

### 4.2 Secure reservation (mid-match, technical plan §14.3)

The one mid-match write. In order, with no step reorderable:

1. The client sends `secure_item { sourceSlot }` (intent only — it names a slot, never an
   item, and cannot assert that the action succeeded).
2. The room validates it against **live simulation state**: the player is alive, their run is
   not over, the slot holds an item, the secure slot is empty, and no other inventory action of
   theirs is in flight (technical plan §14.2's five checks).
3. The room calls `reserve_secure_item(p_reservation_key, p_match_id, p_user_id, p_item_id)`,
   which inserts a `pending` row, or returns the existing row if that key is already reserved.
4. **Only after that call returns successfully** does the room feed the secure intent into the
   next simulation step, which is what moves the item and therefore what the owning client
   observes as success.
5. If the write fails, times out, or the process dies, the item stays in the normal inventory.
   The client is never told the item is secure.

Step 4 is the whole point, and it is enforced structurally rather than by discipline: the only
way a client learns its secure slot is filled is the private-state message derived from
simulation state, and the simulation is not given the intent until the write lands. There is no
code path that reports success and then writes.

At step 4 the room re-checks that the source slot still holds the reserved `item_id`. If it
does not — the player discarded it or died during the write — the reservation is moved to
`cancelled` and the intent is dropped.

### 4.3 Settlement (at run end, technical plan §15.3)

Triggered by the **server** observing that a player's simulation `runResult` became non-null.
No client message triggers settlement, and none can: no client→server message type carries an
outcome, a point value, or a reward, so there is nothing to validate away (§6).

```sql
settle_match_reward(
  p_settlement_key   text,
  p_match_id         uuid,
  p_user_id          uuid,
  p_outcome          text,
  p_reward_payload   jsonb,   -- the immutable payload, computed server-side
  p_points           jsonb,   -- {force, precision, motion, guard, signal}
  p_unlock_ids       text[],  -- ids whose thresholds the new balance crosses
  p_started_at       timestamptz,
  p_ended_at         timestamptz
) returns jsonb
```

Atomically, in one transaction (§18.2's six steps, in its order):

1. verify the settlement key is unused — `insert into reward_ledger … on conflict do nothing`;
2. insert the reward ledger row;
3. add the point balances (`update … set force = force + …`, never a client-supplied absolute);
4. insert unlocks without duplication (`on conflict (user_id, unlock_id) do nothing`);
5. insert or update the match result;
6. mark any `pending` secure reservation for this match and user `settled`, and return the new
   balances and the full unlock set.

If step 1 finds the key already used, **every remaining step is skipped** and the function
returns the previously stored result with `already_settled: true`. This is §18.2's "a repeated
request with the same settlement key returns the existing result instead of awarding twice",
and it is why the caller can retry freely.

Concurrency, explicitly: two transactions calling with the same key race on the unique index.
The second blocks until the first commits, then its `on conflict do nothing` inserts nothing
and its subsequent `select` — a new statement, therefore a new snapshot under `read committed`
— sees the committed row and returns it. Neither transaction can apply the balance update
twice. The unlock thresholds are computed by the caller *before* the call but applied with
`on conflict do nothing`, so a stale threshold list is idempotent too.

The function is `security definer` with `search_path = ''` and is `revoke`d from
`authenticated` and `anon`; only the secret key may execute it.

### 4.4 Crash recovery

Technical plan §14.3: "if the game server crashes, the pending reservation remains in
PostgreSQL; the next login or recovery job finalizes the protected reward."

At join, after authenticating a user, the server calls
`finalize_pending_reservations(p_user_id, …)` for any `pending` row belonging to that user from
a match that is no longer running. Each is settled through **`settle_match_reward` with the key
derived from that reservation's own `match_id` and `user_id`** — that is, the identical key the
crashed match's own settlement would have used.

The consequence is the property this milestone needs: recovery and normal settlement are the
same operation under the same key, so whichever runs second finds the ledger row and awards
nothing. A crash at *any* point between the simulation ending and the write landing produces
exactly one award.

The recovered reward is the secured item's points only. The normal inventory is not recovered:
`docs/DECISIONS.md` D39 already establishes that an abandoned run's carried loot is lost, and
the secure slot is precisely the thing that is promised to survive.

---

## 5. Row-level security

Enabled on all seven tables in the creating migration. Technical plan §18.3 states the rule and
this section states the policies that implement it.

The server does not appear in any policy: it connects with the **secret key**, whose
`service_role` bypasses RLS entirely. Every policy below therefore describes what a *browser*
may do with a publishable key and a user JWT.

### 5.1 Read: own rows only

`select` policies on `profiles`, `point_balances`, `unlocks`, `loadouts`, and `match_results`,
each of the form:

```sql
create policy "<table>_select_own" on public.<table>
  for select to authenticated
  using (user_id = (select auth.uid()));
```

`(select auth.uid())` rather than bare `auth.uid()` so PostgreSQL evaluates it once per query
instead of once per row.

§18.3's "approved public leaderboard data later" is deliberately not anticipated: no policy
exposes another user's rows, and adding one is a later decision with its own review.

### 5.2 Write: denied, except loadouts

`point_balances`, `unlocks`, `match_results`, `reward_ledger`, and `secure_reservations` have
**no `insert`, `update`, or `delete` policy at all**. With RLS enabled and no permissive policy,
every such statement from a browser is denied. This is §18.3's "players must not directly
write" implemented as an absence rather than as a rule to enforce — there is no policy to get
wrong.

`reward_ledger` and `secure_reservations` additionally have **no `select` policy**: a browser
cannot read them either. They contain no information a player needs (their effects are visible
in `point_balances` and `unlocks`) and reading them would leak other players' settlement
timing.

### 5.3 `loadouts`: the one client-writable table

```sql
create policy "loadouts_write_own" on public.loadouts
  for all to authenticated
  using  (user_id = (select auth.uid()) and slot_index < public.loadout_slot_allowance())
  with check (user_id = (select auth.uid()) and slot_index < public.loadout_slot_allowance());
```

where

```sql
create function public.loadout_slot_allowance() returns smallint
  language sql stable
  as $$ select case
         when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 1::smallint
         else 3::smallint
       end $$;
```

A client may create, read, update, and delete **its own** presets, within its allowance. §3.4
explains why this is safe: a preset is a preference the server re-validates at join, never an
entitlement.

Anonymous users get one preset slot; permanent users get three. This is the single place the
`is_anonymous` claim changes behavior (§2.2), and it is the mechanical content of §17.3's
warning: an anonymous account is playing on a reduced, unrecoverable version of the account
surface.

### 5.4 What the tests must prove

`docs/M5_ISSUES.md` M5.9 owns these; they are listed here because they are properties of the
schema, not of the code:

1. A user reads their own `profiles`, `point_balances`, `unlocks`, `loadouts`, and
   `match_results` rows.
2. A user reading another user's rows in any of those tables gets **zero rows** — not an error,
   which is how RLS denies a `select`.
3. A user's `insert`/`update`/`delete` against `point_balances`, `unlocks`, `match_results`,
   `reward_ledger`, and `secure_reservations` fails, including an `update` targeting **their
   own** row (a player may not grant themselves points).
4. A user's `select` against `reward_ledger` and `secure_reservations` returns zero rows.
5. A user writes their own `loadouts` slot `0` successfully.
6. A user writing **another user's** `loadouts` row fails, whichever slot index.
7. An anonymous user writing `loadouts` slot `1` fails; a permanent user writing slot `1`
   succeeds. This is the `is_anonymous` claim, tested in both directions.
8. The secret-key client performs every write in §4, proving `service_role` bypass works and
   that the policies above are not accidentally blocking the server.

---

## 6. What a client can and cannot say

Restating the authority model (technical plan §5.1, `docs/DEVELOPMENT_RULES.md`) in the terms
of this document, because M5 is the first milestone where the answer has money in it.

**There is no settlement message.** The client→server message set is: join options
(handshake + skill loadout ids + access token), `input`, `secure_item`, `discard_item`. Not one
of them has a field capable of expressing a point value, an item's worth, an unlock, an
outcome, or a reward — so there is no "settlement message validation" in the sense of checking
a claimed reward, because no claim can be made. A client that invents a `settle` message hits
the room's `"*"` handler, is counted as invalid behavior, and is disconnected after repeated
attempts (technical plan §33). `docs/M5_ISSUES.md` M5.9 tests exactly that.

What *is* validated at the boundary (`docs/DECISIONS.md` D23 — the validator ships with the
consumer):

| Untrusted input | Validator | Rejects |
| --- | --- | --- |
| `accessToken` in join options | `validateMatchJoinOptions` (shape/length) then Supabase Auth (authenticity) | Malformed, absent when required, expired, forged, or another project's token. |
| `skillLoadoutIds` | `validateMatchJoinOptions` then `createSkillLoadout` then the unlock check | Unknown id, duplicate, over the slot budget, **or not unlocked by this account** (technical plan §19). |
| `secure_item.sourceSlot` | `validateSecureItemMessage` then live simulation state | Out-of-range, non-integer, empty slot, occupied secure slot, dead player. |

The reward itself is computed from the simulation's own `RunResult` — the server's authoritative
record of what that player was carrying — by a pure function in `@carry-or-fall/simulation-core`
that takes no client input at all.

---

## 7. The anonymous account warning (technical plan §17.3)

The warning states what §17.3 states, in the player's terms: an anonymous account **cannot be
recovered** after clearing browser storage, and cannot be used from another device or another
browser. Its progression — every row above — continues to exist and becomes permanently
unreachable.

§17.3 says it appears "after the player gains progression", which fixes both the trigger and
the reason: before any progression there is nothing to lose, and a warning shown to a
first-time visitor is friction on the "instant guest play" §17.1 exists to protect.

The trigger implemented in M5: **the first time a settlement returns a non-zero point total to
an anonymous account.** It is shown on the run-result screen and then persists on the loadout
screen for as long as the account remains anonymous, alongside the account's balances — the
place a player looks at the progress the warning is about.

---

## 8. Migrations

Migrations are **files in this repository**, under `supabase/migrations/`, named
`<timestamp>_<description>.sql` and applied in filename order. The database must be
reproducible from a clean Supabase project by applying them in order and nothing else.

Rules:

- **Never edit schema in the dashboard.** A dashboard change exists in exactly one project and
  is invisible to every other environment, to CI, and to the next person; the schema would stop
  being reviewable in a pull request, which is where every other rule in this repository is
  enforced.
- **Never edit an applied migration.** Change is a new file. An applied file is history.
- **RLS is enabled in the same migration that creates a table**, never a follow-up. A table
  that exists for even one deployment without RLS is a table that was readable by every
  authenticated user of a public project.
- Migrations contain **no data values from any environment** — no keys, no URLs, no project
  refs.

`supabase/README.md` records how to apply them.

---

## 9. Running against a real project

CI has no credentials and cannot reach a Supabase project (`docs/DECISIONS.md` D46). The split:

| Suite | Backend | Runs in CI | Command |
| --- | --- | --- | --- |
| `pnpm test`, `pnpm test:integration` | in-memory adapter implementing the same contract | yes | as today |
| `pnpm test:supabase` | a real Supabase project | no | requires `SUPABASE_URL` + `SUPABASE_SECRET_KEY` |

The settlement and RLS assertions are written **once**, as a contract suite parameterized over
the backend, so the same test bodies run against the fake in CI and against real PostgreSQL
locally. The fake proves the server calls the contract correctly; only the real suite proves
the SQL function and the policies are correct, which is why §5.4's list must be run against a
real project before the schema is trusted.

A fresh clone with no `.env` passes every CI gate: the Supabase suite skips itself when the
variables are absent, rather than failing.
