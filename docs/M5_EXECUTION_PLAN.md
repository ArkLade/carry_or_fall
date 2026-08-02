# M5 Execution Plan — Accounts and Progression

The ordered implementation plan for milestone **M5**, on branch `m5-accounts`. It follows
`docs/M5_ISSUES.md` (the bounded task list) and `docs/DATA_MODEL.md` (the schema, written first per
`docs/DECISIONS.md` D22). Where the three disagree, the issue list and the data model win and this
plan is corrected.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/DATA_MODEL.md`, `docs/M5_ISSUES.md`,
technical plan §14.3, §15.3, §17, §18, §19, §20.2, §38 M5, concept §5, §6, §7.

---

## 1. Order of work, and why this order

Persistence inverts the usual dependency direction. In M1–M4 the engine was written first and the
host came later; here the **schema is the contract** and everything else is written against it, so
the order is outside-in:

1. **Schema** (`supabase/`) — nothing can be written against a schema that does not exist.
2. **Content** (`game-content/unlocks.ts`) — the settlement function needs to know what an unlock is.
3. **Pure rules** (`simulation-core/settlement.ts`) — the reward payload, derivable with no I/O.
4. **The store contract + `MemoryStore`** — the seam every later step programs against, and the one
   CI can run.
5. **`SupabaseStore`** — the real implementation of a contract that already has tests.
6. **Auth and the join gate** — the first place a real credential is used.
7. **Room wiring** — reservation ordering, settlement, recovery.
8. **Client** — auth, display, the warning.
9. **Adversarial tests** — written last only in file order; the assertions are fixed by step 4's
   contract and several are written alongside it.
10. **Documents and decisions.**

Steps 1–5 touch no existing behavior at all, which is deliberate: by the time the room changes
(step 7), everything it calls is already covered.

## 2. Invariants to check at every step

- No database call inside `stepSimulation`, or anywhere on the 50 ms path.
- No secret value in any file, log line, error message, test fixture, or document.
- No `VITE_`-prefixed variable carries anything but public configuration.
- Row-level security is enabled in the same migration that creates each table.
- Every new untrusted input has a validator in the same change (D23).
- No test asserts a constant equals itself.

## 3. Step 1 — `supabase/`

```
supabase/
  README.md
  migrations/
    0001_accounts_and_progression.sql
    0002_settlement_functions.sql
```

`0001` creates all seven tables of `docs/DATA_MODEL.md` §3 with their constraints, enables RLS on
each **immediately after creating it**, creates `loadout_slot_allowance()`, and creates every policy
of §5. `0002` creates the five functions of §4, each `security definer`, `set search_path = ''`, and
`revoke execute … from public, anon, authenticated`.

Watch for: the `precision` column (a reserved word elsewhere, legal unquoted in PostgreSQL); the
`coalesce` around the `is_anonymous` claim (§2.1 — failing toward "permanent" is the safe
direction); `on conflict do nothing` followed by a **separate** `select` in `settle_match_reward`, so
the concurrent caller reads a new snapshot.

Add `supabase/` to `.prettierignore` if Prettier tries to reformat SQL, and confirm ESLint and
`tsc` never see it (it is not under `apps/` or `packages/`).

## 4. Step 2 — `packages/game-content/src/unlocks.ts`

`UnlockDefinition`, `ALL_UNLOCKS`, `DEFAULT_UNLOCK_IDS`, `unlocksEarnedAt(balances)`. Export from
`index.ts`. Bump `CONTENT_VERSION` — D34 requires it whenever a content change would make a stale
client disagree with the server about what a player sees or is awarded, and a client that does not
know a skill is locked disagrees about both.

Tests (`unlocks.test.ts`): thresholds resolve to real skills; the default set covers D31's default
loadout; `unlocksEarnedAt` is inclusive at the threshold and exclusive below it; the ten skills
partition into defaults plus threshold unlocks with the Guard gap asserted explicitly, so the gap is
a documented fact rather than an omission.

## 5. Step 3 — `packages/simulation-core/src/settlement.ts`

`buildRewardPayload(runResult)` and `settlementKey(matchId, userId)`. Pure. Export from `index.ts`.

This is the only new module in `simulation-core`, and it deliberately does not touch `world.ts`,
`simulation.ts`, or any rule module: M5 adds no simulation rule. `run-result.ts`'s doc comment gets
one correction — it says the result "is never persisted (`docs/DECISIONS.md` D27)", which stops
being true here.

## 6. Step 4 — the store contract and `MemoryStore`

```
apps/server/src/progression/
  store.ts          the ProgressionStore interface + result types
  memory-store.ts   in-process implementation, with fault injection for tests
  select-store.ts   startup selection + the production-requires-Supabase rule
```

`store.ts` defines the contract in one place, including the two guarantees the tests exist to check:
`settleRun` is idempotent on the settlement key, and `reserveSecureItem` resolves only after the
write has landed.

`memory-store.ts` gets a small fault-injection surface (`failNextReserve`, `hangNextReserve`,
`failNextSettleAfterCommit`) used only by tests. Keep it on the memory store, never on the interface
— a fault hook on the interface would be a production code path.

`select-store.ts`: Supabase when both variables are present; `MemoryStore` with a warning otherwise;
**throw** when `NODE_ENV=production` and Supabase is absent.

## 7. Step 5 — `SupabaseStore`

Add `@supabase/supabase-js` to `apps/server` and `apps/client` (pinned; the only new dependency this
milestone takes). `supabase-store.ts` calls the five SQL functions by RPC with the secret-key
client. Every method maps one-to-one onto a function; no ad-hoc table writes, so the atomicity lives
in one place.

Extend `apps/server/src/config/env.ts` with `supabaseUrl` and `supabaseSecretKey` — validated like
every other variable, both-or-neither, and **never included in any log or error message**. The
existing `env.test.ts` pattern extends directly.

## 8. Step 6 — auth and the join gate

- `packages/protocol`: `accessToken` on `MatchJoinOptions`, bounded by `validateMatchJoinOptions`
  (a non-empty string under a length cap; authenticity is not a protocol concern).
  `PROTOCOL_VERSION` 2 → 3.
- `apps/server/src/progression/auth.ts`: `verifyAccessToken(token)` → `{ userId, isAnonymous }` via
  the Supabase client's `auth.getUser`, or the fallback identity when no Supabase is configured.
- `MatchRoom.onAuth`: verify token → `ensureAccount` → `loadAccount` → existing
  `createSkillLoadout` check → **new** unlock check → admit. Each refusal keeps its own message.

`onAuth` becomes `async`; Colyseus already supports that. Confirm the `foundation_room` path is
untouched — it has no loadout and no account (D40), and the M0 integration tests passing unchanged
is the evidence.

## 9. Step 7 — room wiring

Three changes to `MatchRoom`, all outside the step:

1. **Reservation before confirmation.** The `secure_item` handler stops setting
   `pendingSecureSlot` directly. It reads the item id from live simulation state, sets
   `inventoryActionInFlight`, awaits `reserveSecureItem`, re-checks the slot still holds that item,
   and only then sets `pendingSecureSlot`. A failed or stale write cancels and drops the intent.
2. **Settlement on run end.** After `stepSimulation`, any player whose `runResult` just became
   non-null is settled once, keyed on `settlementKey(this.matchId, userId)`. The computed payload is
   held server-side until the call succeeds or the room shuts down (technical plan §15.3), and a
   retry reuses the payload rather than recomputing it.
3. **Recovery at join**, after `ensureAccount`.

`matchId` is a server-generated UUID created in `onCreate` — not the Colyseus room id, which is
short and not unique.

## 10. Step 8 — client

```
apps/client/src/account/
  supabase-client.ts   browser client from the two VITE_ variables, or null when unconfigured
  account.ts           anonymous sign-in, session, access token, balances/unlocks reads
  linking-warning.ts   the §17.3 trigger rule (pure, unit-tested)
```

`BootScene` signs in anonymously; `LoadoutScene` shows balances and locked skills and the warning;
`PlayScene`'s result display gains points-gained and unlocks-earned. When `supabase-client.ts`
returns `null` (no configuration), every screen renders without the account panel and the game is
fully playable — which is what keeps the thirty existing browser tests green in CI.

## 11. Step 9 — tests

```
apps/server/test/progression-contract.ts     shared assertions, parameterized over a store
apps/server/test/progression-memory.test.ts  runs them against MemoryStore (CI)
apps/server/test/settlement-adversarial.test.ts  the five double-settle attacks + secure-slot crash
supabase-tests/progression-supabase.test.ts  runs the same assertions + RLS against a real project
```

Add a third vitest project, `supabase`, including `supabase-tests/**/*.test.ts`, and the root script
`test:supabase`. The suite calls `describe.skipIf(!credentialsPresent)` so a fresh clone skips
rather than fails.

`apps/client/test/build.test.ts` gains the secret assertions of `docs/M5_ISSUES.md` §10.10;
`architecture.test.ts` gains §10.11.

## 12. Step 10 — documents

`docs/DECISIONS.md` (restore D26/D27, supersede D27, add D44–D50), `docs/PROTOCOL.md`,
`docs/TEST_PLAN.md`, `docs/CONTENT_AUTHORING.md` §9, `README.md`, `.env.example`.

## 13. Verification

All seven gates, run twice: once with the local `.env` present, once with it renamed aside. The
second run is the fresh-clone check D42 made standard, and it is now also the check that no code
path silently depends on a credential.

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm test:e2e
```

Plus `pnpm test:supabase` against the real project, whose result is reported separately because CI
cannot run it.

## 14. What this plan will not do

No deployment or hosting configuration (M8). No party, queue, or lobby (M6). No boss, boss core, or
blueprint item (M7). No new gameplay rule, no change to the fixed step, no weakening of a §13.4 cap.
No dependency beyond `@supabase/supabase-js`. No table without row-level security. No secret
anywhere outside the gitignored `.env`.
