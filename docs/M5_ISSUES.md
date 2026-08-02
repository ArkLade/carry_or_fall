# M5 Issue List — Accounts and Progression

Status: **Planned** (implementation follows in the same change set as this document). The bounded
task list for milestone **M5**, per technical plan §38 (M5) and the repository's
per-milestone-issue-list practice established at M1–M4. M5 is implemented after M4 on branch
`m5-accounts`.

`docs/DATA_MODEL.md` is a **prerequisite**, not a byproduct: `docs/DECISIONS.md` D22 deferred it to
exactly this milestone, and it is written before the first migration and before any code that reads
or writes the schema. Every issue below refers to it rather than restating the schema.

## Scope

**Deliver (technical plan §38 M5):** anonymous auth, profiles, point balances, unlocks, loadouts,
atomic reward settlement, account linking warning.

**Exit criteria (technical plan §38 M5):**

- Extracted points persist.
- Secure-slot progress persists after death.
- Duplicate settlement does not duplicate rewards.

The third is the one that needs adversarial evidence rather than a happy-path test; §9 (M5.9) is
that evidence.

**Explicitly out of M5** (later milestones or never): parties, join codes, matchmaking queues,
party markers (M6, technical plan §8.4); the boss, boss skill cores, and blueprint loot (M7 — no
such item exists in `@carry-or-fall/game-content` and a persistence milestone does not invent
gameplay content); deployment, hosting, regions, CAPTCHA/Turnstile, load and soak tests (M8+,
technical plan §30.4/§30.5, §17.4 — see §1.7); leaderboards or any policy exposing another user's
rows (technical plan §18.3 says "later"); a persistent ordinary-item stash (concept §7.4 forbids it
permanently); in-run leveling or a level-up draft (`docs/DEVELOPMENT_RULES.md`); mobile controls;
client-side prediction (technical plan §11.2, D37); PvP damage (D41); Redis, presence, or a second
server process (D8); the `account_restrictions` table (`docs/DATA_MODEL.md` §3.8).

## Architectural constraints (apply to every issue)

- **The simulation stays authoritative and stays in `packages/simulation-core`, on the fixed 50 ms
  step.** M5 adds no rule to the step and performs **no database call inside it**. Persistence hangs
  off two events the room already observes — a validated secure intent, and a player's `runResult`
  becoming non-null — and both are handled outside `stepSimulation`.
- **Supabase never holds live match state** (D9). `docs/DATA_MODEL.md` §1 states the boundary as a
  table of the only two writes a match performs. A 50 ms step performs zero.
- **Clients send intentions, never outcomes.** M5 is the first milestone where an outcome is worth
  money, and the answer does not change: no client→server message can express a point value, an
  unlock, an outcome, or a reward. The reward is computed from the server's own `RunResult`.
- **No secret reaches the browser.** The publishable key (`sb_publishable_…`) is bundled by design;
  the secret key (`sb_secret_…`) bypasses row-level security and exists only in the server process.
  This is verified by build-time assertion (§8), not by intention — see §1.6.
- **Row-level security is on for every table in the migration that creates it** (`docs/DATA_MODEL.md`
  §8), never added later.
- **Migrations are files in this repository.** The database must be reproducible from a clean
  Supabase project by applying `supabase/migrations/*.sql` in order.
- **A fresh clone with no `.env` passes every CI gate.** This is D42's rule, generalized: an
  automated suite may not depend on a file that policy forbids committing. See §1.5.
- **The eight §13.4 caps stay enforced in shared code**, untouched by this milestone.
- Each issue passes the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:integration`, `pnpm build`) plus the browser suite (`pnpm test:e2e`), and
  adds tests for any meaningful rule it introduces.

---

## §1. Scope decisions (recorded here, not improvised silently)

### 1.1 What "unlocks" means in M5, and what it cannot mean

Technical plan §38 M5 lists "unlocks" as a deliverable. Concept §19.2–§19.4 names three unlock
*sources*: weapon blueprints, armor blueprints, and boss skill cores. **None of them exist as
content.** `@carry-or-fall/game-content` ships two weapons, ten skills, six loot items, one enemy,
and one arena; there is no blueprint item type, no armor system (concept §8.2), and no boss (M7).

Inventing blueprint loot inside a persistence milestone would be adding gameplay content — a new
item kind, new drop rules, new secure-slot eligibility — which is exactly what
`docs/DEVELOPMENT_RULES.md` means by "do not add unrequested systems".

What M5 ships instead is the unlock source that already has a numeric basis in the concept document:
**point thresholds**. Concept §6.1–§6.5 say of each category, in as many words, that it is "used to
unlock or improve" specific content. So:

- Every account starts with a **default unlock set** (concept §5.4's "viable default set"), which
  includes the three skills `docs/DECISIONS.md` D31 pre-selects, so a fresh account can play the
  documented default loadout with no unlocks earned.
- Five further skills unlock when an accumulated point balance crosses a threshold, each mapped to
  the category whose §6 description names its effect.

Balances are **never decremented**: concept §6 describes no spending, shop, or refund, and adding
one would be inventing a system. See `docs/DECISIONS.md` D48.

**The honest gap:** Guard (§6.4) gets no unlock in M5. §6.4's unlock targets are "armor types,
shield skills, defensive melee behavior" — the one shield skill (`bulwark_strike`) is a default
because D31's default loadout needs it, and armor is unimplemented. This is recorded rather than
papered over with an invented Guard skill.

### 1.2 Unlocks become a real gate, not a decoration

An unlock that nothing checks is a row in a table. Technical plan §19 says what checks it: when a
player selects a pre-run loadout, "the server checks each requested weapon, armor, and skill" and
"rejects locked or incompatible combinations".

M5 therefore extends the join gate D38 already established. `onAuth` currently validates the
requested skill ids through `createSkillLoadout` (shape, duplicates, slot budget). It now *also*
checks every requested id against that account's unlock set, and refuses the join if any is locked
— the same refuse-don't-correct treatment, at the same boundary, one step later.

This is what connects §1.1's thresholds to gameplay: crossing a threshold changes what you may
bring on the next run.

### 1.3 The secure-slot promise is honored, superseding D27

`docs/DECISIONS.md` D27 scoped the secure slot's guarantee to one local run, stating plainly that
the "permanent" half of concept §7.2's promise was deferred until M5 gave "permanent" somewhere
durable to mean. That is now true, so D27 is superseded rather than left to disagree with reality.

`docs/DEVELOPMENT_RULES.md` is specific about the shape: "insertion must be persisted before it is
reported successful, so a server crash cannot invalidate the protection promise." M5 implements
that as an ordering that is structural rather than disciplined (`docs/DATA_MODEL.md` §4.2): the
only way a client learns its secure slot is filled is the private-state message derived from
simulation state, and the simulation is not handed the secure intent until the reservation write
returns. **There is no code path that reports success and then writes**, so there is no window for
a crash to fall into. §9 tests the crash directly.

*(D27's entry, and D26's, were accidentally deleted from `docs/DECISIONS.md` in commit `847fe83`
while twenty-odd references to D27 remained across the documents. This milestone restores both and
then supersedes D27 — see §10.)*

### 1.4 Settlement is server-triggered; there is no settlement message

Restating `docs/DATA_MODEL.md` §6 because it is the answer to "how is the settlement message
validated": **there is no settlement message.** The client→server set is join options, `input`,
`secure_item`, `discard_item`. None has a field for a reward, a point value, an unlock, or an
outcome, so there is no claim to check.

This is consistent with D23 rather than an exception to it: D23 requires a runtime validator no
later than the milestone in which a message first crosses a network boundary. M5 adds exactly one
new untrusted field — the `accessToken` in join options — and it ships with its validator (shape at
the protocol boundary, authenticity at Supabase Auth) in the same change.

A client that invents a `settle` message hits the room's existing `"*"` handler, is counted as
invalid behavior, and is disconnected after repeated attempts (technical plan §33). §9 tests that.

### 1.5 The seven gates run without credentials, and so must a fresh clone

CI has no secrets and cannot reach a Supabase project. D42 established the durable rule this
follows: an automated suite may not depend on a file policy forbids committing.

The design:

- All persistence is behind one interface, `ProgressionStore`. Two implementations: `SupabaseStore`
  (real) and `MemoryStore` (in-process), the second implementing the *same* contract including
  idempotency and the reservation ordering.
- The server selects a store at startup: Supabase when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are
  present, `MemoryStore` otherwise, with a warning log line. **`NODE_ENV=production` without
  Supabase configuration is a startup failure**, so the fallback can never be what a deployment
  silently gets.
- The settlement and RLS assertions are written **once**, as a contract suite parameterized over the
  store, so the same test bodies run against `MemoryStore` in CI and against real PostgreSQL
  locally.
- A third vitest project, `pnpm test:supabase`, runs the real-project suite. With no credentials it
  **skips**, it does not fail.

What genuinely needs a real project, and therefore only runs there: the `settle_match_reward`
function's transactional and concurrency behavior, and every row-level-security policy
(`docs/DATA_MODEL.md` §5.4). `MemoryStore` proves the server calls the contract correctly; only
PostgreSQL proves the SQL is correct. Both statements are made in the final report.

### 1.6 The bundle assertion exists because this class of leak already happened here

`docs/DECISIONS.md` D32 records that the root `.env`'s `NODE_ENV=development` leaked into Vite's
client production build through `envDir`, undetected for three milestones, and shipped a dev-only
debug hook into every production bundle built before it was caught. It was found only because a
verification capability was built specifically to look.

The same class of leak now carries a key that bypasses row-level security, in a public repository
(D25). So M5 adds the corresponding assertions to `apps/client/test/build.test.ts`, alongside the
existing debug-hook and `MATCH_SEED`/`MATCH_LOBBY_MS` ones (§8), plus a source-level architecture
test so a leak is caught before it is built rather than after.

### 1.7 Anonymous-user accumulation and rate limits are recorded for M8, not solved in M5

Supabase does not clean up anonymous users automatically, and anonymous sign-in is IP rate-limited
at 30 per hour by default. Neither matters while the game is unreachable from the internet: M5 is
local, and D25/§38 M8 place the private internet test two milestones away.

Both are recorded as M8 obligations in `docs/DECISIONS.md` D50 — including whether CAPTCHA or
Turnstile is needed then (technical plan §17.4 says "CAPTCHA where recommended") — rather than
solved now with no traffic to measure against. Adding a CAPTCHA provider today would also be an
unapproved dependency.

### 1.8 One reservation per player per match

Concept §7.2 gives each player one secure slot and says a secured item "cannot be removed during the
run"; `packages/simulation-core/src/inventory.ts` has deliberately never had a function that empties
the secure slot. So a player performs **at most one** successful secure action per match, and the
reservation key `'{match_id}:{user_id}'` is not merely unique-by-convention — it is unique because
the gameplay rule says so. `docs/DATA_MODEL.md` §3.7 depends on this.

---

## §2. M5.1 — `supabase/` migrations, RLS on from the first file

**Deliver:** `supabase/migrations/0001_accounts_and_progression.sql` creating the seven tables of
`docs/DATA_MODEL.md` §3, their constraints and indexes, `loadout_slot_allowance()`, and every
row-level-security policy of §5 — all in one file, so no table exists for even one deployment
without RLS. `supabase/migrations/0002_settlement_functions.sql` creating `ensure_account`,
`reserve_secure_item`, `cancel_secure_reservation`, `settle_match_reward`, and
`finalize_pending_reservations`, each `security definer` with `search_path = ''` and revoked from
`authenticated`/`anon`.

**Also:** `supabase/README.md` — how to apply migrations to a clean project, and the rule that
schema is never edited in the dashboard.

**Non-goals:** `account_restrictions` (§3.8); leaderboard policies; seed data of any kind; any
value from any environment appearing in a migration.

**Tests:** §9 (the real-project suite). A migration file has no unit test; its correctness is the
contract suite running against a project it built.

## §3. M5.2 — Progression content: default unlocks and point thresholds

**Deliver:** `packages/game-content/src/unlocks.ts` — `UnlockDefinition`
(`id`, `kind: "unlock"`, `unlockType`, `grantsId`, `requires: { category, amount } | null`),
`DEFAULT_UNLOCK_IDS`, `ALL_UNLOCKS`, and `unlocksEarnedAt(balances)` returning the ids whose
thresholds a balance satisfies. Bump `CONTENT_VERSION` (D34: both ends now read this table — the
client to show what is locked, the server to gate the join).

**Rules:**

- Defaults (concept §5.4, and D31's default loadout must be playable with no earned unlocks):
  `ricochet`, `multishot`, `extended_reach`, `wide_arc`, `bulwark_strike`, plus both weapons.
- Thresholds, each traced to the §6 sentence naming its effect: `stunning_blows` at Force 40
  (§6.1 "stun strength"), `piercing_rounds` at Precision 40 (§6.2 "penetration"), `swift_strikes` at
  Motion 40 (§6.3 "attack speed … recovery speed"), `homing_arrows` at Signal 40 (§6.5 "homing
  projectiles"), `returning_shot` at Signal 100 (§6.5 "unusual targeting"; the rare 2-slot skill,
  D29, so the highest threshold).
- Amounts are proposed and balance-deferred, like every other unsourced number in this repository
  (concept §12.3).

**Non-goals:** Guard unlocks (§1.1's recorded gap); blueprint or boss-core unlocks; mastery levels,
cosmetics, achievements, or statistics (concept §5.2 lists them; none has a mechanic).

**Tests:** every threshold id resolves to a real skill; defaults cover D31's default loadout;
`unlocksEarnedAt` returns an id exactly at its threshold and not one below it; the union of defaults
and thresholds is the full ten-skill table with the Guard gap explicit.

## §4. M5.3 — Reward derivation in `simulation-core`

**Deliver:** `packages/simulation-core/src/settlement.ts` — `buildRewardPayload(runResult)` turning
the existing authoritative `RunResult` into the immutable payload of technical plan §15.3 step 6,
and `settlementKey(matchId, userId)` producing the deterministic key of `docs/DATA_MODEL.md` §3.6.

**Rules:** pure functions, no client input, no I/O. The payload records the outcome, the five-category
point delta, items converted, and items lost — nothing the simulation did not already decide.

**Non-goals:** database access (that is M5.4); recomputing points (that is `points.ts`, unchanged);
any notion of a client-supplied reward.

**Tests:** a death payload carries only the secure slot's points and a non-zero `itemsLost`; an
extraction payload carries inventory plus secure and zero `itemsLost`; the key is a pure function of
its two arguments and is stable across calls.

## §5. M5.4 — The `ProgressionStore` contract, `MemoryStore`, and `SupabaseStore`

**Deliver:** `apps/server/src/progression/store.ts` (the interface), `memory-store.ts`,
`supabase-store.ts`, and `select-store.ts` (§1.5's startup selection). Operations:
`ensureAccount`, `loadAccount`, `reserveSecureItem`, `cancelSecureReservation`, `settleRun`,
`finalizePendingReservations`.

**Rules:**

- `settleRun` is idempotent on the settlement key and returns `{ alreadySettled, balances, unlockIds }`.
- `reserveSecureItem` is idempotent on the reservation key and **resolves only when the write has
  landed**; a failure rejects rather than resolving falsely.
- `MemoryStore` implements the same semantics, including both idempotency guarantees and a
  configurable failure/latency injection used by §9's adversarial tests.
- `SupabaseStore` uses `@supabase/supabase-js` with the **secret key** and calls the SQL functions
  by RPC; it never issues an ad-hoc `update` against a balance.
- The secret key is read from `SUPABASE_SECRET_KEY`, validated at startup like every other server
  variable, and **never logged** — not at debug level, not in an error path, not in a metrics line.

**Non-goals:** an ORM or query builder beyond the Supabase client; connection pooling; a second
database; caching account data across matches.

**Tests:** the contract suite (§9), run against both stores.

## §6. M5.5 — Anonymous auth, token verification, and the join gate

**Deliver:**

- Client: `apps/client/src/account/supabase-client.ts` (browser client from `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY`) and `account.ts` (anonymous sign-in on boot, session persisted in
  browser storage per technical plan §17.1, access token exposed for the join).
- Protocol: `accessToken` added to `MatchJoinOptions`, validated for shape/length by
  `validateMatchJoinOptions`. `PROTOCOL_VERSION` 2 → 3.
- Server: token verification through Supabase Auth (`auth.getUser(token)`), `ensureAccount`, and the
  §1.2 unlock gate — all in `onAuth`, so an unauthenticated or under-unlocked client never occupies
  a seat.

**Rules:**

- A token is required when the server has Supabase configured. In the `MemoryStore` fallback a
  missing token yields a per-session local identity, which is what keeps CI and a fresh clone
  playable (§1.5) — and production cannot reach that path, because production without Supabase does
  not start.
- The client never sends a user id: identity comes from the verified token only.
- Refusals are distinguishable: an invalid token, an illegal loadout, and a locked skill each carry
  their own message.

**Non-goals:** email/OAuth linking flows (technical plan §17.2 — the *warning* is M5's deliverable,
§7; performing a link is a UI flow M6's lobby owns); local JWT signature verification (it needs a
JWT dependency beyond the Supabase client); session refresh strategy beyond the SDK's default.

**Tests:** a configured server refuses a join with no token, a malformed token, and a token from
another project; refuses a loadout naming a locked skill and admits the same loadout once the unlock
row exists; the fallback server admits a tokenless join and mints distinct identities per session.

## §7. M5.6 — Secure-slot reservation before confirmation

**Deliver:** the ordering of `docs/DATA_MODEL.md` §4.2 in `MatchRoom`: validate against live
simulation state → `reserveSecureItem` → *then* hand the intent to the next step. Plus the
in-flight guard (technical plan §14.2's fifth check) and the re-check-then-cancel path when the
slot changed during the write.

**Non-goals:** securing more than one item (§1.8); removing an item from the secure slot (concept
§7.2 forbids it); a database call anywhere inside `stepSimulation`.

**Tests:** §9.

## §8. M5.7 — Settlement at run end, and recovery at join

**Deliver:** the room observing `runResult` becoming non-null and calling `settleRun` with the
deterministic key; a retry policy that reuses the same key and preserves the computed payload
(technical plan §15.3's "never calculate a second independent reward"); `finalizePendingReservations`
at join; a server→client `settlement` message carrying the new balances and any newly earned
unlocks.

**Non-goals:** a background recovery job or scheduler (§14.3 offers "the next login **or** recovery
job"; login is sufficient and adds no process); retrying forever (a bounded retry, then the
reservation stays `pending` for recovery to finish).

**Tests:** §9.

## §9. M5.8 — Client: balances, unlocks, and the account linking warning

**Deliver:** `LoadoutScene` shows the account's five balances and marks locked skills as locked,
reading `point_balances` and `unlocks` **directly from Supabase with the publishable key** — which
is the RLS read path working from a browser, not a convenience. The run-result screen shows points
gained and any unlock earned. The §17.3 warning appears per `docs/DATA_MODEL.md` §7: first shown
when a settlement returns a non-zero point total to an anonymous account, then persistent on the
loadout screen while the account stays anonymous.

**Rules:** the client renders progression; it never computes it. With no Supabase configuration the
scene shows the same screen without balances, so the browser suite keeps running (§1.5).

**Non-goals:** a link flow (§6's non-goals); cosmetics or mastery display; a stash screen (concept
§7.4).

**Tests:** browser-suite coverage that the loadout screen still starts a run with no Supabase
configured; unit coverage of the warning's trigger condition.

## §10. M5.9 — Adversarial evidence for the three exit criteria

The milestone's hardest requirement, written as its own issue because it is what the exit criteria
are judged on. Every test below runs against `MemoryStore` in CI and against a real project under
`pnpm test:supabase`.

**Duplicate settlement — five attacks, one award each:**

1. **The same run settled twice.** Call `settleRun` twice with the same key; assert balances
   increased once and the second call reports `alreadySettled`.
2. **Concurrent settlement of one run.** Fire N concurrent `settleRun` calls with one key via
   `Promise.all`; assert exactly one applied and the balance equals a single award.
3. **Retry after a simulated network failure.** Inject a failure after the write would have landed,
   then retry with the same key; assert one award. (This is the dangerous case: the caller does not
   know whether the first attempt succeeded.)
4. **A client replaying a settlement message.** Send a fabricated `settle`-shaped message from a
   real client; assert it is counted invalid, awards nothing, and repeated attempts disconnect it.
5. **A crash between the simulation ending and the write landing.** Compute the payload, destroy
   the room without settling, then run join-time recovery; assert exactly one award — and assert the
   same when the crash happens *after* the write landed but before the room learned it did.

**Secure-slot progress after death:**

6. Secure an item, die, settle; assert the secured item's points are in the persisted balance and
   the reservation is `settled`.
7. **The crash-between-report-and-write case** (`docs/DEVELOPMENT_RULES.md`): make the reservation
   write fail or hang, and assert the client's secure slot never fills — the item stays in normal
   inventory and drops on death, which is the truthful outcome. Then assert that with the write
   succeeding but the process dying immediately after, join-time recovery still awards the item
   exactly once.
8. The slot changed during the write: assert the reservation is `cancelled` and nothing is awarded.

**Extracted points persist:**

9. Extract carrying inventory plus a secured item; assert the persisted balance equals the sum of
   both, that a threshold crossed by that sum grants its unlock exactly once, and that a second
   extraction crossing the same threshold does not insert a duplicate unlock row.

**Secrets and isolation:**

10. `apps/client/test/build.test.ts`: the production bundle contains no `SUPABASE_SECRET_KEY`, no
    `sb_secret_` prefix, no non-`VITE_`-prefixed `SUPABASE_URL`, and none of the other server-only
    variable names.
11. `apps/client/test/architecture.test.ts`: no file under `apps/client/src` references a server-only
    variable or imports the server progression modules, and every `import.meta.env.*` read in client
    source is on an allowlist.
12. Row-level security, `docs/DATA_MODEL.md` §5.4's eight properties — including a user reading
    another user's rows getting zero rows, a user failing to update their **own** balance, and the
    `is_anonymous` loadout allowance tested in both directions. Real project only; skipped without
    credentials, and the final report says so plainly.

---

## §11. Documentation this milestone must update

- `docs/DECISIONS.md` — restore D26/D27 (deleted in `847fe83`), supersede D27 per §1.3, and record
  D44–D50 (the M5 decisions).
- `docs/PROTOCOL.md` — protocol version 3, the `accessToken` join field, the `settlement` message.
- `docs/TEST_PLAN.md` — the third vitest project and what needs a real project.
- `docs/CONTENT_AUTHORING.md` — §9, authoring an unlock.
- `README.md`, `.env.example` — Supabase setup, and that only `.env.example` is ever tracked.
- `docs/DATA_MODEL.md` — already written; updated only if implementation contradicts it, with the
  contradiction reported.
