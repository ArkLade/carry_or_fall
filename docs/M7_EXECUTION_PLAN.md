# M7 Execution Plan — Boss and Rare Skill

The ordered implementation plan for milestone **M7**, on branch `m7-boss`. It follows
`docs/M7_ISSUES.md` (the bounded task list). Where the two disagree, the issue list wins and this
plan is corrected.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/M7_ISSUES.md`, `docs/DECISIONS.md` D29,
D33, D44, D48, D53, D55, D59, D62, D63; technical plan §13.4, §14.3, §15.3, §19, §38 M7; concept
§9.2–§9.5, §11, §14.3, §29.4, §34.

---

## 1. Order of work, and why this order

M7 adds one entity, one item behaviour with three branches, one combat primitive, and one settlement
rule. They depend on each other in exactly one direction, so the order is bottom-up and each step is
testable before the next exists:

1. **Content** — the boss, the core, the rare skill, the unlock, the lair. Everything below reads
   these tables, and nothing here has behaviour to get wrong.
2. **Split projectiles and caps 5–6** — a self-contained change to `combat/ranged.ts`. Done before
   the boss, because it is the milestone's only change to an existing hot path and it is far easier
   to see a regression in isolation than underneath a new entity.
3. **The boss** — a new module plus one documented position in `stepSimulation`'s ordering.
4. **The three-way core decision** — the new intent, the inventory rule, and `RunResult` reporting
   which cores converted.
5. **Settlement** — unlock versus duplicate conversion, decided once.
6. **Protocol and server** — the message, the validator, the synchronized boss, the room handler.
7. **Client** — rendering and the activate key.
8. **Adversarial tests** — last in file order only; the assertions are fixed by steps 2–5 and
   several are written alongside them.
9. **Documents, decisions, margin audit.**

Steps 1–2 change no existing behaviour a current client can observe, which is deliberate: by the
time the boss exists (step 3), the primitive it hands out is already covered.

## 2. Invariants to check at every step

- No §13.4 cap is raised, relaxed, or bypassed; the split path is clamped by caps that already
  exist.
- No database call inside `stepSimulation`, or anywhere on the 50 ms path.
- No client-supplied value decides what a core grants, when a boss attacks, or what a settlement
  awards.
- Every new untrusted input has a validator in the same change (D23).
- `supabase/migrations/` stays untouched (`docs/M7_ISSUES.md` §1.5).
- The Supabase suite's anonymous sign-in count stays at five per run (D63).
- No test asserts a constant equals itself.

## 3. Step 1 — `packages/game-content`

```
boss.ts       BossDefinition, BossAttack, ALL_BOSSES, findBoss
loot.ts       BossCoreRecord on LootDefinition; splitReturnCore
skills.ts     splitReturn (slotCost 2)
unlocks.ts    UnlockSource: "default" | "threshold" | "boss_core"
arena.ts      bossSpawnPoint
version.ts    CONTENT_VERSION bump
```

Watch for: `ALL_LOOT` is the random drop table, so `splitReturnCore` must **not** be in it —
`chooseLootDrop` picks from it and a core must only ever come from the boss. Add `ALL_BOSS_CORES`
separately and a test that the two lists do not intersect.

The unlock table gains a third source. `requires: null` currently means "default", so introducing a
boss-core unlock means the discriminator becomes explicit rather than inferred from a null — the kind
of change that is cheap now and expensive after a fourth source.

## 4. Step 2 — split projectiles and caps 5–6

`Projectile` gains `isSplitChild: boolean`. `combat/ranged.ts`'s hit branch, where a projectile is
consumed by a target, gains the split:

```ts
if (effects.splitCount > 0 && canProjectileSplit(projectile.isSplitChild)) { … }
```

and the expiry branch's return gains the second gate:

```ts
if (projectile.canReturn &&
    canProjectileReturn(projectile.returnsSoFar) &&
    canChildCreateParentEffect(projectile.isSplitChild)) { … }
```

Children are fanned around the parent's direction, inherit its damage scaled by the content-declared
factor, are marked `isSplitChild: true`, and carry `canReturn: false`. The number spawned is clamped
by `clampProjectilesPerAttack` and then by `clampSpawnForActiveCap` against the owner's live count.

Watch for: the split happens where the parent is *consumed*, so a piercing projectile that survives
its hit must not also split — decide and document which wins (pierce continues, no split, because
the projectile was not consumed).

## 5. Step 3 — the boss

```
packages/simulation-core/src/boss.ts
```

`Boss` on `World`: `definitionId`, position, lair, health, phase, per-attack cooldowns, telegraph
state. `stepBoss` is a pure function over the boss, the players, and the wall grid.

`stepSimulation`'s ordering gains one line, documented as a rule: the boss steps **with the
enemies**, after projectiles have resolved and before pass 2's pickups, so a boss killed this step
drops its core in time for the same step's pickup pass to be unable to take it (the drop lands, the
pickup happens next step) — one ordering, stated, rather than two plausible ones.

Watch for: `nearestLivePlayer` already exists and already skips finished runs; reuse it rather than
writing a second target selector.

## 6. Step 4 — the core decision

`InputState.activateCoreSlotIndex`, applied between discard and secure. `inventory.ts` gains
`activateBossCore(inventory, slotIndex)` returning `{ inventory, core, activated }` — a refusal, not
a throw, matching `secureItem`.

`run-result.ts` gains `bossCoreIds`: on death, only a secured core; on extraction, the secured core
plus every core in the inventory.

Watch for: the activated core is **gone** from the inventory, so it is not in `bossCoreIds` — that
is concept §11's "lost on death" and "cannot be secured", and it means an activated core never
reaches settlement at all.

## 7. Step 5 — settlement

`RewardPayload.bossCoreIds`. `SettlementService.settle` splits each id into either an unlock grant or
duplicate-conversion points, from `args.account.unlockIds`, **before** the first write.
`recoverPending` does the same from a freshly loaded account.

Watch for: the payload must be computed once and reused across retries (it already is); the
classification must not be re-derived inside the retry loop.

## 8. Step 6 — protocol and server

```
packages/protocol   ACTIVATE_CORE_MESSAGE_TYPE, ActivateCoreMessage,
                    validateActivateCoreMessage, BossView, PROTOCOL_VERSION bump
apps/server         MatchState.boss, match-sync, the room's handler
```

The handler mirrors `discard_item` exactly: validate, rate-limit through the existing `InputGuard`,
store a one-shot slot index consumed by the next tick.

## 9. Step 7 — client

Boss body, health bar, phase tint, and a telegraph ring for the area attack in `world-view.ts`; the
core's three affordances in the inventory HUD; `C` to activate in `keyboard.ts`; the settlement
screen naming a new unlock or a duplicate conversion. Debug hook gains `getBoss()`.

## 10. Step 8 — tests

```
packages/simulation-core/src/boss.test.ts          the boss's own rules
packages/simulation-core/src/split-caps.test.ts    caps 5 and 6, through the real pipeline
packages/simulation-core/src/boss-core.test.ts     the three branches as pure rules
apps/server/test/boss-core-decision.test.ts        the three branches under attack, real sockets
apps/server/test/settlement-adversarial.test.ts    M5's set, extended to carry a core
apps/client/e2e/boss.spec.ts                       one browser test: kill it, take the core, extract
```

The new server file binds a real port, so it joins `vitest.config.ts`'s `integration-server` project
(D54's serialised half).

## 11. Step 9 — documents and the margin audit

`docs/DECISIONS.md` D65–D68 (D48 superseded in place by D66); `docs/PROTOCOL.md`;
`docs/TEST_PLAN.md` (§13.4 caps table, new suites, margins); `docs/CONTENT_AUTHORING.md`;
`README.md`.

Then `E2E_MARGIN=1 pnpm test:e2e`, with the table reported. Anything under about 40% is fixed here.

## 12. Verification

All seven gates, run twice: once with the local `.env` present, once with it renamed aside. Ports
2567 and 5173 cleared before every browser run. Plus `pnpm test:supabase` against the real project,
reported separately with its sign-in count.

## 13. What this plan will not do

No PvP damage, no boss projectiles (D59). No knockback (scheduled to M7.5). No migration. No new
dependency. No mastery schema. No second boss. No weakening of a §13.4 cap. No deployment (M8).
