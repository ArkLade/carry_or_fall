# M7 Issue List — Boss and Rare Skill

Status: **Planned** (implementation follows in the same change set as this document). The bounded
task list for milestone **M7**, per technical plan §38 (M7) and the repository's
per-milestone-issue-list practice established at M1–M6. M7 is implemented after M6 on branch
`m7-boss`.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/DECISIONS.md` (D29, D30, D33, D41, D44,
D48, D53, D55, D59), `docs/DATA_MODEL.md` §3.3/§3.6/§4.3, technical plan §13.4, §14.3, §15.3, §19,
§38 M7; concept §9.2–§9.5, §11, §14.3, §19.4, §29.4, §30.1, §34.

---

## Scope

**Deliver (technical plan §38 M7):** one boss, boss core, temporary use, secure permanent unlock,
duplicate conversion.

**Exit criteria (technical plan §38 M7):**

1. All three boss-core decisions work.
2. Settlement remains idempotent.

The first is concept §11's three-way risk decision, and each branch carries a rule that has to hold
**under attack** rather than on the happy path — §11 below is that evidence. The second puts M5's
settlement work under load it has never seen: a single run can now end with a permanent unlock
*and* a duplicate conversion in the same write. §12 re-runs M5's whole adversarial set against a
settlement that carries a core.

**Explicitly out of M7** (later milestones or never): player-versus-player damage and boss
projectiles that damage players (M7.5, D59 — §1.4); knockback (§1.7, and D33 is restated rather than
quietly left open); a second boss, elite enemies, or rare map objectives as further core sources
(concept §19.4 lists them; one boss is what §38 M7 asks for and §14.3 says explicitly not to build a
complex one); weapon or armor blueprints (concept §19.2–§19.3 — no armor system exists, §8.2);
mastery levels as a storage concept (§1.6, D67); a boss loot table beyond the single core; boss
respawn; deployment (M8); any new Supabase table, column, or migration (§1.5).

## Architectural constraints (apply to every issue)

- **The simulation stays authoritative and stays in `packages/simulation-core`, on the fixed 50 ms
  step.** The boss is stepped by the same loop as everything else, in a documented position in
  `stepSimulation`'s ordering, because a contested outcome must resolve identically on every machine
  replaying the same inputs.
- **The boss and its core are content, not engine special cases.** `BossDefinition` declares the
  move set, the phase change, the leash, and what it drops; `boss.ts` reads that table and
  implements no per-boss behaviour. A second boss must be a definition plus tests.
- **The eight §13.4 caps stay in shared code and are never weakened.** M7 makes two of them
  *reachable* for the first time (§1.2); it does not raise, relax, or bypass any of them, and the
  new split behaviour is clamped by the caps that already exist rather than by a new looser one.
- **Clients send intent, never outcomes.** The core decision adds exactly one inbound message type
  (`activate_core`), carrying a slot index and nothing else — no skill id, no unlock id, no reward.
- **Runtime validation at every network boundary**, in the same change (D23).
- **No secret reaches the client bundle or any `VITE_` variable.**
- **A fresh clone with no `.env` passes every gate** (D42, D46).
- Each issue passes the standard gates plus the browser suite, and adds tests for any meaningful
  rule it introduces.

---

## §1. Scope decisions (recorded here, not improvised silently)

### 1.1 The core is loot that carries a core record, not a new inventory type

Concept §29.4 gives the boss core its own definition shape. The tempting reading is a new content
kind and a widened `Inventory` type — and that would ripple through pickup, the secure slot, death
drops, extraction conversion, points, and the private-state message, for a thing that behaves
*exactly* like loot in every one of those places.

So a boss core is a `LootDefinition` with `rarity: "boss"` carrying an optional `bossCore` record
holding §29.4's fields: `temporarySkillId`, `permanentUnlockId`, `secureSlotAllowed`, and
`duplicateConversion`. Everything that already works keeps working unchanged — it is picked up with
`attemptPickup`, dropped on death by the existing death path (which is what makes §11.2's "another
player can take it off your body" true without new code), secured by `secureItem`, and carried
through `RunResult` by the existing conversion rules.

**The core's own `points` are zero.** Its value is `duplicateConversion`, and that is applied only
when the account already holds the unlock (§1.6). Giving it ordinary points as well would make the
first core award both an unlock and points, which would blur precisely the distinction §38 M7's
first exit criterion asks to be demonstrated.

`chooseLootDrop`'s random table excludes boss-rarity items, so a core can only ever enter the world
from the boss that dropped it. Asserted, because "cores come from bosses" is otherwise a property of
a table that a later content edit could silently break.

### 1.2 Caps 5 and 6 become reachable, and are driven through the real pipeline

Since M3 this repository has recorded §13.4's caps 5 (a split projectile cannot split again) and 6
(a child effect cannot create a parent effect) as **unreachable from live gameplay**: they were
implemented in `combat/caps.ts` and exercised only by their own unit tests, because splitting is
boss-core-exclusive per concept §11/§29.4 and there was no boss.

M7 makes them reachable. Concept §29.4's worked example is `split_return_core`, whose temporary
skill is `split_return`, and that skill is exactly the pair of primitives the two caps bound:

- **Split, on hit.** A projectile consumed by a target bursts into `splitCountAdd` children fanned
  around its direction of travel. Cap 5 gates it: a child that hits a target does **not** split
  again (`canProjectileSplit(projectile.isSplitChild)`).
- **Return, on expiry.** Cap 6 gates it: a child may **not** return, because return is the parent
  effect and a child creating one is the recursion concept §9.5 forbids by name
  (`canChildCreateParentEffect(projectile.isSplitChild)`).

Both are enforced where the projectile actually lives (`combat/ranged.ts`), not in the content
table, and the child count is clamped by the caps that already exist — `clampProjectilesPerAttack`
(cap 1) and `clampSpawnForActiveCap` (cap 7) — rather than by a new, looser one. §11.6 drives a real
`split_return` attack through `stepProjectiles` and asserts no grandchild is ever created and no
child ever returns. The §13.4 table in `docs/TEST_PLAN.md` is updated in the same change: after M7,
**all eight caps are reachable from live gameplay**.

### 1.3 The three-way decision is three existing mechanisms, plus one new intent

Concept §11's three options map onto machinery that mostly exists:

| Option | Mechanism | New code |
| --- | --- | --- |
| Activate now | the core leaves the inventory and becomes `wildcardSkill` | one intent, `activate_core` |
| Carry normally | it sits in the inventory like any loot | none |
| Place in secure slot | the existing `secureItem` path, including D44's write ordering | none |

**"Cannot be secured after activation" is structural, not a check.** Activation *removes the core
from the inventory*, and `secureItem` can only move an item that is in a slot. There is no rule to
enforce and no flag to consult, which is the same shape M4 used for "a client cannot claim a
position": the message that would express it has nowhere to land.

The ordering inside one tick is a decision, not an accident. `stepPlayerAttacks` applies inventory
intents in the order **discard → activate → secure**, so a client that sends activate and secure for
the same slot in the same tick activates it and the secure finds an empty slot and refuses. The
room's existing `confirmSecureActions` reconciliation then withdraws the reservation, because it
compares the reservation against *what the simulation actually did* rather than against what was
requested — which is the machinery M5 built after a real defect of exactly this shape between
discard and secure (D44). §11.1 races the two in one tick and asserts the reservation is withdrawn.

### 1.4 Where the boss lives, how it attracts players, and why it has no projectiles

Concept §14.3 wants a boss that attracts nearby players and creates *optional* PvPvE conflict. PvP
damage is M7.5 (D59), so the second half cannot exist yet, and inventing it here would pre-empt a
milestone that exists precisely so it is designed rather than absorbed.

What M7 ships is the attraction without the conflict:

- **A fixed lair, and a leash.** The boss occupies one arena position and never leaves a bounded
  radius around it. It aggros a player inside `aggroRadiusPx` and returns when they leave. Concept
  §14.3's "attract nearby players" is the rare drop and a visible, published threat you choose to
  approach — not a mechanic that drags players together.
- **The leash is also what protects the rest of the suite.** A boss that roamed would erode every
  browser-test margin M6 measured; a leashed one cannot reach any route those tests take, and the
  placement is chosen against them (§1.8). That is a by-construction bound, not a budget.
- **No boss projectiles.** All three attacks are melee-arc or area effects centred on the boss.
  Projectiles that damage *players* are the same plumbing M7.5 owns (`AttackTarget` widening, D59),
  and adding it here would be doing that milestone's work under this one's name. §14.3's "support
  melee and ranged interaction" is about how a *player* engages the boss, and both weapons work.

The consequence is stated rather than hidden: a purely melee boss can be kited by a ranged player.
The area attack's radius and the boss's move speed are set so kiting takes real movement, and like
every other unsourced number here they are proposed and balance-deferred (concept §12.3).

### 1.5 No migration, and why that is a fact rather than a preference

M7 writes two new things to permanent storage: a boss-core unlock, and duplicate-conversion points.
Neither needs schema.

- The unlock is a row in `unlocks` with `unlock_type = 'skill'`, which the existing check constraint
  already permits (`0001_accounts_and_progression.sql`).
- Duplicate conversion is points, which `settle_match_reward` already adds.
- The reward payload gains a `bossCoreIds` field, and `reward_payload` is `jsonb`.

So `supabase/migrations/` is untouched and **D53 does not attach to this milestone**. `pnpm
test:supabase` is still run once against the real project to confirm the contract suite is
unaffected, and its sign-in count is reported — it must stay at the five per run M6 left it at
(D63), because the dashboard limit is back to 30 per hour.

### 1.6 Duplicate conversion is points, not mastery — and D48 is superseded in place

Concept §11 offers "progression points **or** mastery progress" for a duplicate core, and §19.2–§19.4
repeat the same either/or for blueprints. M7 takes points.

Mastery would need somewhere to live: a per-account, per-content-id level with its own table, its
own row-level-security policies, its own idempotency story, and a rule for what a level *does*.
Concept §5.2 lists "limited mastery upgrades" and §30.1 asks for "modest mastery", but neither
document says what a mastery level grants, so building the schema now would be inventing the
mechanic to justify the table. Points already exist, already settle idempotently, and already feed
thresholds. Recorded as D68; mastery stays available to the milestone that defines what it does.

**D48 is superseded, not contradicted.** D48 recorded unlocks as point thresholds *because* concept
§19's other sources did not exist as content, and named boss cores as the source that would arrive
at M7. That is now true, so D48 is superseded in place by D67 rather than left to disagree with the
code — the repository does not keep two records of the same rule (D62).

Which branch a settlement takes is decided **once**, from the account snapshot the room already
holds, before the first write. A retry never recomputes it (`SettlementService` holds the payload,
D44's retry rule), and even if it did, the store's idempotency on the settlement key means the
recomputed payload is never applied. §12.4 tests exactly that: settle, then settle again under a
state where the account now holds the unlock, and assert nothing is awarded twice.

### 1.7 D33's knockback deferral, restated with current facts

D33 deferred knockback because covering concept §9.4's four example combinations needs eleven skills
and technical plan §38 M3 scoped that milestone to "8 to 10".

That reason has expired: §38 M7 sets no skill count, so the range no longer binds. The deferral
still holds for a different and better reason, and it is restated rather than left as a stale
citation (D69): M7's rare skill is `split_return`, a **projectile** primitive, and knockback is a
**displacement-on-hit** primitive. Adding both in one milestone means two new combat primitives
landing alongside a boss, an intent, and a settlement change — and the displacement one interacts
with exactly the thing M7.5 is for (concept §16's solo/group balance, where being pushed matters).
Knockback is therefore scheduled into M7.5 rather than deferred indefinitely.

### 1.8 The boss must not erode the browser suite's timing margins

M6 built `E2E_MARGIN=1 pnpm test:e2e` and recorded the suite's worst-case margins after making the
helpers spend server time rather than machine time (`docs/TEST_PLAN.md` §2.3.0). A boss in the arena
is the first content change since that could take them back.

The boss's lair is therefore chosen **against the routes the suite actually walks**, not just
somewhere thematically sensible:

- `walkToArenaPoint`'s worst case is the far-side skill chip at `(1740, 620)`, reached along the
  lower lane and up the eastern edge.
- `meetChasers` walks to `(1200, 900)`; `walkToOpenLane` goes through `(700, 900)`; the
  `returning_shot` test fires from `(400, 900)`.
- The extraction test takes the point nearest spawn, `(200, 200)`.

The lair sits in the **upper far quadrant**, far enough from every one of those that the leash
radius cannot reach them. §13 re-runs the margin audit and reports the table; anything under about
40% is fixed in this milestone rather than left for CI.

---

## §2. M7.1 — Content: the boss, its core, and the rare skill

**Deliver:** in `packages/game-content`:

- `boss.ts` — `BossDefinition` (`kind: "boss"`): health, radius, move speed, `aggroRadiusPx`,
  `leashRadiusPx`, an `attacks` table of three entries (two normal, one area — concept §14.3), a
  phase change (`enrageBelowHealthFraction`, `enrageIntervalMultiplier`), and `coreLootId`.
  `ALL_BOSSES`, `findBoss`.
- `loot.ts` — `BossCoreRecord` (§29.4's shape) and `splitReturnCore`, the one core M7 ships:
  `rarity: "boss"`, zero `points`, `bossCore: { temporarySkillId: "split_return",
  permanentUnlockId: "split_return", secureSlotAllowed: true, duplicateConversion: {...} }`.
- `skills.ts` — `splitReturn`, `slotCost: 2` (D65), `requiresTags: ["projectile"]`,
  `effects: { splitCountAdd, returnEnabled }`.
- `unlocks.ts` — `split_return` as a **boss-core** unlock rather than a threshold: a new
  `UnlockSource` discriminator so `requires: null` no longer means "default".
- `arena.ts` — `bossSpawnPoint` on `ArenaDefinition`, placed per §1.8.
- Bump `CONTENT_VERSION` (D34: both ends now read a table that decides what a player sees and is
  awarded).

**Non-goals:** a second boss; a boss loot table; elite enemies; blueprint items; mastery levels.

**Tests:** the core's `permanentUnlockId` resolves to a real skill; the core is absent from the
ordinary drop table; the boss's three attacks are exactly two normal plus one area; every unlock id
resolves and the defaults still cover D31's loadout; `split_return` is not a default and not a
threshold.

## §3. M7.2 — Simulation: the boss

**Deliver:** `packages/simulation-core/src/boss.ts` plus a `Boss` entity on `World`.

- `spawnBoss(definition, position)`; `stepBoss(boss, players, dtMs, grid)` — leash-bounded pursuit
  of the nearest live player inside `aggroRadiusPx`, return to lair otherwise, per-attack cooldowns,
  the phase change at the health fraction, and the area attack's telegraph.
- Damage to the boss reuses the existing `AttackTarget` shape, so both weapons and every skill work
  against it with no new code.
- On death the boss drops its core as ground loot at its position, through the existing
  `spawnGroundLoot`.
- `stepSimulation` gains the boss in a documented position in its ordering.

**Non-goals:** boss projectiles (§1.4); boss respawn; multiple bosses in one world.

**Tests:** §11.5.

## §4. M7.3 — Simulation: the three-way core decision

**Deliver:** `InputState.activateCoreSlotIndex`, applied in `stepPlayerAttacks` between discard and
secure (§1.3); `activateBossCore` in `inventory.ts` returning a typed refusal rather than throwing;
the activated core's skill becomes `wildcardSkill`; `run-result.ts` reports `bossCoreIds` converted.

**Non-goals:** de-activation; swapping an activated core back into inventory; more than one core.

**Tests:** §11.1–§11.4.

## §5. M7.4 — Split projectiles, and caps 5 and 6

**Deliver:** `Projectile.isSplitChild`; `SkillEffects.splitCountAdd`; split-on-hit and the two cap
gates in `combat/ranged.ts` (§1.2); the §13.4 caps table updated in `docs/TEST_PLAN.md`.

**Non-goals:** raising any cap; a new cap constant that duplicates an existing one.

**Tests:** §11.6.

## §6. M7.5 — Settlement: unlock and duplicate conversion

**Deliver:** `RewardPayload.bossCoreIds`; `SettlementService` maps each converted core to either an
unlock grant (first) or `duplicateConversion` points (already held), decided once from the account
snapshot; `recoverPending` does the same for a secured core, so a crash cannot lose a boss unlock.

**Non-goals:** any schema change (§1.5); mastery.

**Tests:** §12.

## §7. M7.6 — Protocol and server

**Deliver:** `ACTIVATE_CORE_MESSAGE_TYPE` plus `validateActivateCoreMessage`; `BossView` in the
synchronized state and `MatchState`; the room's message handler and rate limiting, reusing the
existing `InputGuard`; `PROTOCOL_VERSION` bump.

**Non-goals:** a message that names a skill, an unlock, or a reward.

**Tests:** §11.1, §11.7.

## §8. M7.7 — Client

**Deliver:** boss rendering (body, health bar, phase tint, telegraphed area attack), the core in the
inventory HUD with its three affordances, the `C` key for activate, and the settlement screen naming
a new unlock or a duplicate conversion. Debug-hook accessors for the boss and the wildcard.

**Non-goals:** a boss-specific UI screen; a minimap.

**Tests:** §13 (browser).

---

## §9. M7.8 — Documents and decisions

`docs/DECISIONS.md` D65–D69; D48 superseded in place by D67; `docs/PROTOCOL.md`;
`docs/TEST_PLAN.md` (the §13.4 caps table, the new suites, the margin table);
`docs/CONTENT_AUTHORING.md` (boss and core authoring); `README.md` (the boss and the `C` key).

---

## §10. M7.9 — What the caps table says after M7

`docs/TEST_PLAN.md` carries the §13.4 table. After this milestone every cap is reachable from live
gameplay, and the table says which mechanic reaches it — so "unreachable" is never again a standing
claim nobody re-checks.

---

## §11. Tests — exit criterion 1, adversarially

### 11.1 `boss-core-decision.test.ts` (server integration, real sockets)

1. **Activate then secure, same tick.** One client sends `activate_core` and `secure_item` for the
   same slot in the same tick. The core is the wildcard, the secure slot is empty, and the
   reservation the room opened is **withdrawn** — asserted against the store, not against a message.
2. **Secure then activate, same tick.** The reverse arrival order, and — **corrected during
   implementation** — the same outcome, not the mirrored one this line first predicted. §1.3 of this
   document fixes the intra-tick order as discard, then activate, then secure, so *arrival* order
   inside a 50 ms step decides nothing: activation always resolves first and empties the slot. Two
   plausible rules cannot both hold, and the one written down in §1.3 is the one implemented and
   tested. The prediction here was simply wrong, and is left visible rather than quietly rewritten.
3. **Activate then secure, later ticks.** Activation, then a secure request for that slot, then for
   every other slot index: none of them secures the core, and none opens a reservation.
4. **A fabricated message cannot secure an activated core.** `secure_item` with an out-of-range slot,
   with a `coreId` field bolted on, and an invented `secure_core` type: the first two are refused by
   the validator, the third lands in the `"*"` handler and is counted as abuse.
5. **Activation is not repeatable.** Two `activate_core` messages for the same slot yield one
   wildcard and no second effect.

### 11.2 Carry normally

The core stays lootable: a player who dies with a core in normal inventory drops it, and **another
player picks it up off the body** (concept §15.2) and extracts with it. Asserted from the second
player's own private state and settlement.

### 11.3 Place in secure slot

A secured core provides **no** combat power while carried — asserted by firing before and after
securing and comparing the projectiles the server actually published — survives death, and unlocks
exactly once (§12.2).

### 11.4 Duplicate conversion

A second core on an account that already holds the unlock converts to points, creates no second
inventory object, and grants no second unlock.

### 11.5 `boss.test.ts` (simulation-core unit)

Aggro inside the radius and not outside; the leash bound holds however far the player runs; each of
the three attacks fires on its own interval and damages a player in range and not out of it; the
phase change fires once at the health fraction and shortens intervals; death drops exactly one core
at the boss's position; a dead boss deals no damage.

### 11.6 `split-caps.test.ts` (simulation-core unit)

A real `split_return` attack driven through `stepProjectiles`: the parent splits on hit into a
clamped number of children; **no child ever splits** (cap 5); **no child ever returns** (cap 6); the
parent still returns once (cap 4 unchanged); the per-player active cap (cap 7) bounds the burst; and
the whole thing stays inside `MAX_PROJECTILES_PER_ATTACK` (cap 1).

### 11.7 Architecture assertions

The client contains no boss rule; `MatchState` carries no core-decision field a client could set;
`activate_core` carries a slot index and nothing else.

## §12. Tests — exit criterion 2, adversarially

M5's `settlement-adversarial.test.ts` set, re-run against a settlement that carries a boss core:

1. the same run settled twice;
2. concurrent settlement of one run;
3. a retry after a failure the caller cannot distinguish from success;
4. a client replaying a settlement message;
5. a crash **before** the write, recovered later;
6. a crash **after** the write, recovered later;

plus the two M7 cases:

7. a run that ends with **both** a new unlock and a duplicate conversion in one settlement;
8. a secured core whose reservation is recovered by a later join, granting the unlock exactly once.

D44's ordering applies to a secured core exactly as to ordinary loot: the reservation is written and
awaited before the simulation is given the secure intent, so there is no code path that reports
success and then writes.

## §13. Verification

All seven gates, twice: once with the local `.env` present, once with it renamed aside. Ports 2567
and 5173 are cleared before every browser run (M6 lost a run to a stale reused dev server).

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm test:e2e
E2E_MARGIN=1 pnpm test:e2e      # the margin audit, reported in full
```

Plus `pnpm test:supabase` against the real project, with its sign-in count reported (§1.5).

## §14. What this milestone will not do

No PvP damage and no boss projectiles (D59). No knockback in M7 (§1.7). No migration, table, or
column. No new dependency. No weakening of any §13.4 cap. No mastery schema. No second boss. No
deployment.
