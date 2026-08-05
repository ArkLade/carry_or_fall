# Architecture Decisions

This file records approved architecture decisions for **Carry or Fall**. Each entry lists the
decision, the reason, the consequences, and its status. Decisions are drawn from the two
authoritative documents; see `docs/DEVELOPMENT_RULES.md` for the durable rules they imply.

Status values: **Approved** (decided and in force), **Reserved** (approved for a later
milestone, not implemented yet).

---

## D1. Phaser 4.2.x for the browser client

- **Decision:** Use Phaser 4.2.x as the browser game framework. Pinned to `4.2.1`.
- **Reason:** The game needs top-down 2D WebGL rendering, input, sprites, particles, audio, and
  UI scenes, with a TypeScript codebase that coding agents can read and modify. Technical plan
  §1, §2.1, §2.7 mandate Phaser 4.2.x pinned at initialization.
- **Consequences:** No Unity WebGL build burden. Client is a static bundle. Dependency is pinned
  in the lockfile and only upgraded through a dedicated PR.
- **Status:** Approved.

## D2. TypeScript across client, server, shared packages, and tests

- **Decision:** Use TypeScript everywhere with strict compiler settings. Pinned to `6.0.3`.
- **Reason:** Reduces client/server translation errors and helps agents reason about the code
  (technical plan §2.2). `strict: true`, no implicit `any`, no unchecked payloads are required.
- **Consequences:** A shared base tsconfig plus per-project configs. TypeScript is pinned to
  6.0.3 rather than the newest 7.x line because the current lint toolchain
  (`typescript-eslint@8.65.0`) supports TypeScript `<6.1.0`; "current compatible stable" is 6.0.3.
- **Status:** Approved.

## D3. Vite for the browser build

- **Decision:** Use Vite for the client dev server and production build. Pinned to `8.1.5`.
- **Reason:** Fast dev server and standard static build for Phaser + TypeScript (technical plan §1).
- **Consequences:** Client output is a static bundle suitable for CDN hosting later.
- **Status:** Approved.

## D4. Node.js 24 LTS for the server runtime

- **Decision:** Target Node.js 24 LTS for the game server. Development uses `v24.15.0`.
- **Reason:** Technical plan §0, §1, §2.7 pin Node.js 24 LTS.
- **Consequences:** CI uses Node 24. Server code and types target Node 24 APIs.
- **Status:** Approved.

## D5. Colyseus 0.17.x for authoritative match rooms

- **Decision:** Use Colyseus 0.17.x for the authoritative multiplayer server, composed from its
  modular packages rather than the `colyseus` umbrella. Server pinned to `@colyseus/core@0.17.45`
  + `@colyseus/ws-transport@0.17.13` + `@colyseus/schema@4.0.30`, with `express@5.2.1` (and
  `@types/express@5.0.6`) as a direct dependency. Both the browser client and the server-side
  integration tests use `@colyseus/sdk@0.17.43` (the schema-v4 client that matches the 0.17
  server). Server tooling is pinned to `tsx@4.23.1` (dev runner) and `esbuild@0.28.1` (production
  bundle).
- **Reason:** Colyseus provides authoritative rooms, state sync, and lifecycle, which is simpler
  and safer than raw WebSocket management (technical plan §2.3, §2.7). The modular packages are
  the maintained 0.17 distribution and let the transport be constructed explicitly so tests can
  read the bound port. `@colyseus/sdk` is the 0.17 client line (superseding the legacy
  `colyseus.js`), so client and server share one wire/schema version instead of relying on
  cross-version compatibility.
- **Consequences:** One room equals one match. `express` is a required runtime dependency because
  `@colyseus/ws-transport` imports it statically; it also serves the `/health` endpoint via the
  Colyseus `express` option. The production server bundle is produced by esbuild with the Colyseus
  packages and express marked external. No `@colyseus/testing` is used — integration tests drive a
  real listening server with `@colyseus/sdk`, verifying the client/server connection rather than
  assuming it.
- **Status:** Approved.

## D6. pnpm workspaces for the monorepo

- **Decision:** Use pnpm workspaces. pnpm `11.18.0`, provisioned via Corepack.
- **Reason:** Technical plan §1 selects pnpm workspaces for the monorepo.
- **Consequences:** A single lockfile at the root. pnpm is run through Corepack (bundled with
  Node), so no system-wide pnpm install is required.
- **Status:** Approved.

## D7. One match per Colyseus room

- **Decision:** Each Colyseus room represents exactly one complete match.
- **Reason:** Maps naturally to the game and keeps match state owned by one room (technical plan
  §2.3, §8.1).
- **Consequences:** Room lifecycle equals match lifecycle. M0 uses a single connection-only
  `foundation_room`.
- **Status:** Approved.

## D8. One game-server process and replica initially

- **Decision:** Run exactly one game-server process and one replica until Colyseus multi-process
  presence and matchmaking are deliberately implemented.
- **Reason:** Colyseus rooms live in one process's memory; extra replicas before presence
  coordination route players to different processes and break rooms (technical plan §0.6, §2.6).
- **Consequences:** No horizontal scaling until a dedicated scaling milestone. No Redis in M0.
- **Status:** Approved.

## D9. Supabase for persistent account progression (implemented M5)

- **Decision:** Supabase (Auth + PostgreSQL) will store permanent account progression.
- **Reason:** Instant guest play, optional linking, and progression storage (technical plan §2.4).
- **Consequences:** Supabase must never hold live match state. It was not implemented in M0; M5
  added Auth, PostgreSQL migrations, server-owned settlement, and row-level security.
- **Status:** Approved and implemented in M5.

## D10. Cloudflare Pages reserved for later client deployment

- **Decision:** The static client will be deployed to Cloudflare Pages.
- **Reason:** Free global static hosting with HTTPS (technical plan §2.5).
- **Consequences:** Client deployment is independent from the server. **Not implemented in M0.**
- **Status:** Reserved.

## D11. Railway reserved for later game-server deployment

- **Decision:** The authoritative game server will be deployed to Railway Hobby, one persistent
  replica, Serverless sleeping disabled. Render Starter is a fixed-price fallback.
- **Reason:** Technical plan §0.1, §1, §2.6 select Railway Hobby as primary host.
- **Consequences:** **Not implemented in M0.** No Railway configuration or variables exist yet.
- **Status:** Reserved.

## D12. Desktop browser support first

- **Decision:** Target current stable desktop Chrome, Edge, Firefox, and desktop Safari first.
- **Reason:** Mobile requires touch controls, responsive HUD, and device testing not yet done
  (technical plan §37).
- **Consequences:** No mobile controls or claims until separately tested.
- **Status:** Approved.

## D13. No Unity

- **Decision:** Do not use Unity WebGL.
- **Reason:** Larger downloads, slower startup, harder text-based modification, more build
  complexity, and a multiplayer server is still required (technical plan §24.5).
- **Consequences:** The client is a Phaser + TypeScript web app.
- **Status:** Approved.

## D14. No peer-to-peer hosting

- **Decision:** Never make a player host the match; use a dedicated authoritative server.
- **Reason:** Peer hosting causes host cheating, migration problems, NAT issues, and unstable
  authority (technical plan §25).
- **Consequences:** A small dedicated server cost is accepted in later milestones.
- **Status:** Approved.

## D15. No microservice architecture

- **Decision:** Keep a single authoritative game-server responsibility; no microservice split.
- **Reason:** Unneeded complexity for an 8-player prototype (technical plan §44).
- **Consequences:** Scale up before scaling out; revisit only with measured evidence.
- **Status:** Approved.

## D16. No Supabase implementation during M0

- **Decision:** M0 adds no Supabase dependencies, environment variables, schema, or code.
- **Reason:** M0 is the repository foundation only; accounts and persistence belong to M5.
- **Consequences:** `.env.example` contains no Supabase variables. Persistence is deferred.
- **Status:** Approved.

## D17. No gameplay implementation during M0

- **Decision:** M0 implements no gameplay: no movement, combat, enemies, loot, inventory,
  extraction, skills, or bosses.
- **Reason:** M0 establishes the foundation and one verified client-to-server connection only
  (technical plan §38 M0).
- **Consequences:** The client shows foundation status and connection state; the server hosts a
  connection-only room. Gameplay begins at M1.
- **Status:** Approved.

## D18. Refuse incompatible clients at the join boundary

- **Decision:** The client sends its protocol and build version as Colyseus **join options**;
  the server validates them in `onAuth` and refuses an incompatible or malformed client at the
  join boundary, returning `PROTOCOL_MISMATCH_CODE` (4001) with a refresh/update message. The
  client surfaces that message. The reported version gates compatibility only and is never
  trusted as game state.
- **Reason:** Technical plan §35 requires preventing an incompatible client from joining and
  showing a refresh/update prompt, so a stale tab cannot send messages a newer server no longer
  understands. Rejecting at join (rather than accepting then kicking) means an incompatible
  client never occupies a seat.
- **Consequences:** The protocol package owns the handshake shape, the mismatch code, and the
  message; both ends share them. M0 uses exact protocol-version matching; a later milestone may
  widen it to a supported range and add the content version.
- **Status:** Approved.

## D19. Client can reach the health endpoint; CORS is allowlisted

- **Decision:** The browser client fetches the server's HTTP `GET /health` and surfaces the
  result, proving HTTP reachability independently of the WebSocket (technical plan §38 M0 exit
  criteria). Because the client and server are different origins, `/health` returns
  `Access-Control-Allow-Origin` reflecting **only** an origin in `ALLOWED_ORIGINS`; other origins
  receive the body without a CORS grant — never a wildcard (technical plan §20.3).
- **Reason:** §38 lists "client can reach health endpoint" as an M0 exit criterion, and a
  browser cannot read a cross-origin response without a matching CORS header. The health/HTTP
  contract lives in the shared protocol package and the client validates the response at the
  boundary.
- **Consequences:** Colyseus's router reflects any origin by default; the `/health` handler
  overrides that to enforce the allowlist. Broader origin hardening across all HTTP routes (and
  OPTIONS preflight) is a deployment-milestone concern, not M0.
- **Status:** Approved.

## D20. Server reads the root `.env` via Node `--env-file`

- **Decision:** The server `dev` and `start` scripts load the repository-root `.env` with Node's
  `--env-file-if-exists=../../.env`, so `PORT`, `ALLOWED_ORIGINS`, `GAME_BUILD_VERSION`,
  `LOG_LEVEL`, and `NODE_ENV` from the single documented `.env` take effect for the server, just
  as Vite loads the `VITE_*` vars for the client.
- **Reason:** The README instructs copying `.env.example` to a root `.env`; previously only the
  client honored it. `--env-file-if-exists` keeps the file optional (defaults still apply when it
  is absent, e.g. in CI and integration tests) and real environment variables still take
  precedence, matching how a production host injects secrets.
- **Consequences:** One root `.env` configures both sides. No dotenv dependency is added. Running
  the built server directly with `node dist/index.js` from another directory would not find
  `../../.env`; use the `start` script (run from the server package) instead.
- **Status:** Approved.

## D21. GitHub dependency and code scanning (Dependabot + CodeQL)

- **Decision:** Enable Dependabot (`.github/dependabot.yml`) for the npm/pnpm and github-actions
  ecosystems and a CodeQL workflow (`.github/workflows/codeql.yml`) analyzing JavaScript/
  TypeScript on push, pull request, and a weekly schedule.
- **Reason:** Technical plan §31 requires using "dependency and code scanning available through
  GitHub." Dependabot's update PRs also fit the pinned-dependency, upgrade-only-through-a-PR
  policy (§2.7).
- **Consequences:** Scanning surfaces advisories and update PRs; it never deploys or auto-merges.
  Both workflows validate only, consistent with the M0 rule that CI performs no deployment.
- **Status:** Approved.

## D22. Defer `docs/DATA_MODEL.md` to M5

- **Date:** 2026-07-30.
- **Decision:** `docs/DATA_MODEL.md` — the Supabase/PostgreSQL schema, the atomic reward
  settlement function, secure-slot reservations, and row-level security (technical plan §18) — is
  deliberately **not authored yet**. It is written when persistence work begins, at M5.
- **Reason:** Technical plan §46 lists `DATA_MODEL.md` among the documents to create before major
  gameplay code, but milestones M1–M4 (local combat, loot and extraction, data-driven skills, and
  authoritative multiplayer) introduce **no persistent storage**: they run in memory with no
  Supabase dependency, variables, schema, or code (see D9 and D16). Authoring the data model now
  would be speculative and would likely be rewritten once account and reward requirements are
  concrete at M5. The other §46 pre-gameplay documents that M1–M4 actually depend on — `PROTOCOL.md`,
  `CONTENT_AUTHORING.md`, `TEST_PLAN.md`, and the M1 issue list — are written now.
- **Consequences:** No `DATA_MODEL.md` exists during M1–M4. M5 ("Accounts and Progression") must
  author it before any migration, and the same milestone owns `supabase/` migrations, the
  `settle_match_reward` function, and RLS policies. Until then, no code reads or writes a persistent
  schema; secure-slot and reward persistence remain explicitly unimplemented (D9, D16).
  **Fulfilled in M5:** `DATA_MODEL.md` was authored before the migration and persistence code.
- **Status:** Approved and fulfilled in M5.

## D23. Runtime validators ship with the first networked consumer

- **Decision:** Message *types* may be added to `packages/protocol` ahead of their
  network use, but the runtime validator for a message is written no later than the
  milestone in which that message first crosses a network boundary. M1 adds
  `InputMessage` without a validator because M1 has no untrusted boundary; M4 must
  add the validator in the same change that makes the server consume it.
- **Reason:** `DEVELOPMENT_RULES.md` forbids empty layers for features that do not
  exist yet, but also requires runtime validation at every network boundary and
  forbids unchecked payloads. Deferring one validator with no consumer is fine;
  letting M2 and M3 accumulate unvalidated message types and retrofitting them all
  at M4 is not.
- **Consequences:** No message reaches a network boundary without schema, range, and
  state validation. The deferral applies only to types with no consumer.
- **Status:** Approved.

## D24. Client bundle code-splitting deferred to the deployment milestone

- **Decision:** The client production bundle is approximately 1.49 MB (Phaser
  dominates) and Vite emits its >500 kB warning on every build. No code-splitting or
  asset optimization is performed during local gameplay milestones. Revisit at M8
  (private internet test), governed by technical plan §36 Asset Delivery.
- **Reason:** First-load size matters once real players load the client over the
  internet. Optimizing before the asset set exists would be premature.
- **Consequences:** The Vite size warning is expected in every build until M8 and is
  not treated as a regression. M8 must measure first-load size and apply the §36.1
  strategies.
- **Status:** Reserved.

## D25. Public repository

- **Decision:** The repository is public. `.github/workflows/codeql.yml` runs as
  advanced setup, and secret scanning is active. Default setup for code scanning
  must not be enabled, because it would disable the committed workflow.
- **Reason:** Technical plan §31 asks for GitHub dependency and code scanning.
  GitHub restricts code scanning to public repositories on Free and Pro plans, so
  public visibility is what makes §31 achievable without a paid license. Actions
  minutes are also unmetered for public repositories.
- **Consequences:** All source, all documents, and the entire commit history are
  public. No credentials have ever been committed (verified: `.env` was never
  tracked across all 5 commits). Any future secret must go through provider
  settings, never the repository. Forked pull requests can run workflows, so
  "Require approval for all external contributors" stays enabled under
  Settings → Actions → General.
- **Status:** Approved.


## D26. Projectile and dash collision defects moved to M2 — SUPERSEDED

- **Original decision:** D-1 (projectiles pass through walls) and D-2 (dash
  tunnels through thin walls) are not fixed in M1. Both are moved into M2 and
  must be fixed before M2 loot and extraction work is declared done.
- **Original reason:** M1's three §38 exit criteria are met without them. Both
  share one root cause — `resolveAxisMovement` is a discrete landing-position
  check rather than a swept path check — so they are one fix, not two, and are
  better done together.
- **Original consequences:** Ranged combat has no line of sight to break until
  this is fixed; combat balance must not be judged before then. The §13.4
  bounce cap may be exercising an unreachable code path.
- **Superseded:** this decision was reversed before it was ever committed. D-1
  and D-2 were fixed directly in M1, not deferred, using exactly the shared
  swept-collision approach this entry anticipated —
  `sweptCircleIntersectsWall` in `packages/simulation-core/src/collision.ts`,
  used by both `resolveAxisMovement` (actor movement and the dash) and
  `combat/ranged.ts`'s `stepProjectiles`. See `docs/M1_ISSUES.md` D-1/D-2
  (marked resolved) for the fix and its regression tests. The bounce-cap
  caveat still holds as written: `MAX_BOUNCES`/`clampBounceCount` remain
  unreachable from running gameplay, because no mechanic produces a bounce
  yet (M3's `ricochet` skill) — this fix deliberately did not add one.
- **Status:** Superseded (see above); no longer in force.
- **Restored 2026-08-01:** this entry and D27 were deleted from this file by
  commit `847fe83` ("docs: record D28"), which rewrote the tail of the file
  rather than appending to it — the "\ No newline at end of file" markers on
  both sides of that diff are the fingerprint. Neither deletion was intentional:
  D27 in particular was referenced by more than twenty passages across
  `docs/M2_ISSUES.md`, `docs/M2_EXECUTION_PLAN.md`, `docs/M3_ISSUES.md`,
  `docs/M4_ISSUES.md`, `docs/M4_EXECUTION_PLAN.md`, `docs/CONTENT_AUTHORING.md`,
  and D39, every one of which pointed at nothing. Both are restored verbatim
  from `847fe83^`; D27 is then superseded by D44 below, which is what M5
  actually changes about it.

## D27. M2 secure slot protects within the local run only; no cross-run persistence

- **Date:** 2026-07-31.
- **Decision:** In M2, the secure slot's guarantee is scoped to the current local run only. An
  item placed in the secure slot never drops on death (unlike normal inventory) and converts into
  the run's point totals identically whether the run ends by death or by successful extraction
  (`docs/M2_ISSUES.md`, `packages/simulation-core/src/run-result.ts`). It does **not** survive a
  browser refresh, a process restart, or accumulate across separate runs — M2 writes the run
  result nowhere durable; the run-result screen is the only place it is ever shown.
- **Reason:** `docs/DEVELOPMENT_RULES.md` requires that, once the secure slot is truly
  implemented, "insertion must be persisted before it is reported successful, so a server crash
  cannot invalidate the protection promise." That requirement describes the real M5
  implementation, where an authoritative server and a database both exist. M2 has neither (D9,
  D16, D22): there is no server to crash mid-match and no account or database row for "permanent
  progress" to be written into yet. Concept §7.2/§4.3–4.4 describe the secure slot surviving death
  and converting to "permanent progress," but that promise is only meaningful once M5 gives
  "permanent" somewhere durable to mean. Implementing a fake persistence layer now, or silently
  claiming the M5 guarantee already holds, would both be worse than stating the gap plainly.
- **Consequences:** M2's secure slot is real and testable within a single local run (it changes
  behavior — no drop on death, uniform conversion — and is covered by tests), but the "permanent"
  half of its promise is deferred, not delivered. M5 must implement the real persisted settlement
  path (technical plan §18's atomic settlement function, per D22) before the secure slot's
  protection promise is honest at the account level; M2 must not be cited as evidence that promise
  is already met.
- **Status:** **Superseded by D44** (M5 shipped the persisted settlement path this entry called
  for). Kept because M1-M4 documents cite it and because it is the record of what was true then.

## D28. v0.1.0-local-combat predates the D-1/D-2 collision fix

- **Decision:** The public tag `v0.1.0-local-combat` points at a commit where
  projectiles pass through walls (D-1) and a dash can tunnel through a thin wall
  (D-2). The tag is not moved, because it is already published. The collision fix
  travels to `main` with the M2 merge instead.
- **Reason:** Moving a published tag rewrites history other people may already
  have. Cherry-picking the fix onto `main` separately was attempted and abandoned
  as unnecessary complexity, since M2 carries the same commit.
- **Consequences:** `v0.1.0-local-combat` is not a good playable build. The first
  tag with correct collision is the M2 tag, `v0.2.0-loot-extraction`.
- **Status:** Approved.

## D29. One two-slot rare skill; loadout selection rejects, effect magnitude clamps

- **Date:** 2026-07-31.
- **Decision:** M3 ships exactly one 2-slot skill, `returning_shot` (concept §9.4's "Returning
  Projectiles"); every other of the ten `ALL_SKILLS` costs 1 slot. Slot cost is validated by
  `packages/simulation-core/src/skill-loadout.ts`'s `createSkillLoadout(skillIds)`, which sums
  every selected skill's `slotCost` against `MAX_SKILL_SLOTS = 3` and **rejects** — a typed
  `{ ok: false, reason }`, never a silently trimmed loadout — a selection with an unknown id, a
  duplicate id, or a total slot cost over the budget. Separately, a *legal* loadout's summed effect
  *magnitude* (e.g. stacking `stunChanceAdd` from the permanent loadout and an identical wildcard)
  is **clamped** in `skill-effects.ts`, exactly like M2's `build-effects.ts` already clamps carried
  loot.
- **Reason:** Concept §8.3 permits "strong rare skills may cost two slots" without requiring one to
  exist; shipping exactly one is enough to prove the two-slot mechanic works (`returning_shot` plus
  one 1-slot skill fits; plus two 1-slot skills does not) without inventing several rare skills with
  no numeric source in either authoritative document. The reject-vs-clamp split follows the existing
  M2 precedent directly: a full inventory or an already-occupied secure slot is refused (no smaller
  version of "select four slots' worth of skills" exists), while carried-loot build effects are
  clamped (a legal build must keep working, just capped) — M3 extends the same rule to skills rather
  than inventing a third policy.
- **Consequences:** `createSkillLoadout` is the one validation boundary a pre-run loadout choice must
  pass through before it ever reaches `createSimulation` (client `LoadoutScene` calls it live, per
  toggle). `skill-effects.ts`'s caps (and, for bounce/pierce/return/search-radius, the pre-existing
  `combat/caps.ts` §13.4 ceilings) are the only place effect magnitude is bounded; no function
  refuses or throws for exceeding one.
- **Status:** Approved.

## D30. Wildcard skill chips are scattered ground pickups, not a boss-core drop

- **Date:** 2026-07-31.
- **Decision:** M3's wildcard skill chip (concept §10) is a `SkillChip` ground entity scattered on
  the local test map at run start — the skill counterpart of M2.6's `GroundLoot` scattering, using
  the same non-goal workaround (no new enemy type, no boss). Its skill is chosen via the seeded RNG
  from the same `ALL_SKILLS` pool the permanent loadout draws from, not a boss-exclusive subset.
- **Reason:** Concept §10 (wildcard) and concept §11 (boss skill cores) are two separate systems;
  §10 names no source for the temporary chip, while §11's mechanic is explicitly boss-gated, and
  bosses are M7 (`docs/M2_ISSUES.md` §1 already deferred all boss content). M3 has no boss and adds
  no new enemy type, so a boss-core-sourced wildcard is not achievable this milestone; scattering
  chips is the same treatment M2.6 already gave ordinary loot for the identical reason.
- **Consequences:** Every wildcard chip a player can find in M3 grants an ordinary skill, including
  the 2-slot `returning_shot` — there is no boss-exclusive skill roster yet. When M7 adds boss skill
  cores, they become a second, boss-exclusive wildcard source alongside (not replacing) this one.
- **Status:** Approved.

## D31. Pre-run skill selection is a local, non-persistent client screen, not a lobby

- **Date:** 2026-07-31.
- **Decision:** A new client-only `LoadoutScene` is shown before `PlayScene`. It lets the player
  toggle up to three permanent skills (validated live against `createSkillLoadout`, D29) and press
  Enter to start a run with the confirmed loadout, passed as Phaser scene data. A documented default
  loadout (`ricochet`, `extended_reach`, `bulwark_strike`) is pre-selected. Nothing is written to
  storage; the choice does not survive a page reload; there is no networked matchmaking or waiting
  room.
- **Reason:** Concept §8.3 requires skills to be "selected before entering the match," and technical
  plan §38 M3 lists "three pre-run skill slots" as a played deliverable, not just internal engine
  state — but M3 still has no account or lobby (M5/M6, D9/D16). A local menu screen is not a lobby (a
  lobby implies matchmaking or a multiplayer waiting room; this is a single-player menu, the same
  category of thing as M2's Enter-to-restart convenience) and needs no persistence to exist.
- **Consequences:** `main.ts`'s scene order changes: `LoadoutScene` is now the client's entry scene,
  ahead of `PlayScene` (previously the direct entry point per `docs/M1_EXECUTION_PLAN.md` §9). The
  Enter-to-restart convenience keeps the same loadout across a restart (an in-memory scene field, not
  persistence) so a human can playtest repeatedly without returning to the picker every run. When M5
  adds accounts and M6 adds lobbies, this screen's validation logic (`createSkillLoadout`) is reused;
  its ephemeral, no-persistence framing is what changes.
- **Status:** Approved.

## D32. Playwright pulled forward from M5 to M3; browser suite runs as a separate CI job

- **Date:** 2026-07-31.
- **Decision:** Add `@playwright/test` (pinned `1.62.1`) as a client devDependency and install the
  Chromium browser binary, superseding `docs/TEST_PLAN.md` §2.3's earlier "Playwright is not
  installed... add it around M5" deferral — that section is corrected in this same change so it and
  this entry do not contradict each other. The suite (`apps/client/e2e/*.spec.ts`) runs as a
  **separate CI job**, not a seventh step in the existing six-gate `verify` job.
- **Reason:** A prior M3 follow-up task reported, for the fourth consecutive session, that it could
  not visually verify client behavior — no browser automation capability existed. That gap blocked
  diagnosing a reported "skills don't behave correctly in the running game" defect: 273 unit tests
  already proved every effect function correct in isolation, so the only way to find a wiring defect
  between the real client and the simulation (if one existed) was to actually drive a browser.
  Technical plan §30.3 already requires this layer, and §38 M4's "two real browsers can play" exit
  criterion presupposes it, so this is required infrastructure arriving two milestones early, not new
  scope. Running the suite as a separate job (not a seventh gate) follows from the task's explicit
  "do not slow or destabilize the existing six gates": a real Chromium instance, animation-frame
  timing, and live-enemy navigation are categorically slower and more failure-prone than the six
  fast, deterministic gates, and mixing them would make the fast gates' signal noisier.
- **Consequences:** `pnpm-lock.yaml` gains Playwright and its transitive packages; no `allowBuilds`
  entry was needed in `pnpm-workspace.yaml` — verified empirically that `@playwright/test`/
  `playwright-core`/`playwright` ship no npm install/postinstall build script under pnpm 11's
  build-script gate, so `pnpm install` did not require one. Browser binaries are fetched separately
  via `playwright install chromium` (already how Playwright is meant to be used; not a pnpm
  build-script concern). A dev-only, read-only debug hook
  (`apps/client/src/debug/debug-hook.ts`, `docs/TEST_PLAN.md` §2.3) was added so tests can observe
  simulation state through the `<canvas>` Phaser renders to; it is gated on `import.meta.env.DEV`
  and verified absent from the production bundle by a `test:integration` assertion. Building this
  gate correctly surfaced and fixed a real, pre-existing defect: the shared root `.env`'s
  `NODE_ENV=development` (there for the server, D20) was also leaking into Vite's own
  production/development detection for the **client** build, via `envDir` pointing at that same
  file — `import.meta.env.DEV` stayed `true` even inside `vite build`'s output. Fixed in
  `apps/client/vite.config.ts` by defining `import.meta.env.DEV`/`PROD` explicitly from Vite's
  `command` parameter (reliably `"serve"` vs `"build"`) instead of trusting the NODE_ENV-influenced
  default. This means the debug hook would have shipped in every production client bundle built
  before this fix, undetected, until this verification capability was built specifically to catch
  it.
- **Status:** Approved.

## D33. Knockback deferred; M3 ships ten skills

- **Decision:** M3 ships ten skills. A knockback skill is not added, so concept
  §9.4's Defensive Melee Combination (Shield on Attack, Knockback, Wide Arc) is
  covered only in part. Knockback is added in a later content milestone.
- **Reason:** The concept document is authoritative for gameplay and names four
  example combinations; covering all four needs eleven skills, one past technical
  plan §38 M3's "8 to 10". The plan's range scopes M3, not the game's total skill
  count. Knockback is also a §9.2 core primitive that simulation-core does not
  implement — a displacement effect on hit — so it is a primitive addition, not a
  content addition, and does not belong in a milestone that is otherwise closing.
- **Consequences:** Three of four §9.4 combinations are fully playable. Adding
  knockback later requires a new primitive in simulation-core plus a content
  definition, and serves as a live check that the data-driven claim holds.
- **Status:** **Superseded by D69**, which schedules knockback into M7B rather than leaving it to
  "a later content milestone". Kept as the record of M3's reasoning.
## D34. The content version activates in the join handshake

- **Date:** 2026-07-31.
- **Decision:** `CONTENT_VERSION` (new, in `@carry-or-fall/game-content`) is sent in the join
  handshake alongside the protocol and build versions, and gates the join by **exact match**, exactly
  like `PROTOCOL_VERSION`. `packages/protocol` gains `isContentCompatible(peerVersion, localVersion)`
  — two arguments, so the protocol package keeps its no-dependencies property — and both rooms call it
  through the shared `authorizeHandshake`. This supersedes `docs/PROTOCOL.md` §3's "Reserved" row,
  which is updated in the same change.
- **Reason:** Technical plan §35 requires the client and server to exchange **three** versions.
  `docs/PROTOCOL.md` §3 deferred the third with an explicit condition — "when `game-content` gains
  real definitions (M2-M3), add a `CONTENT_VERSION` constant here and include it in the handshake" —
  and that condition is now satisfied: there are weapons, an enemy, loot, ten skills, and an arena.
  It matters at M4 specifically because both ends now read those tables for different purposes: the
  client draws melee arcs, projectile behavior cues, and point previews from its copy while the
  server computes outcomes from its copy. A client with a stale table would draw a different arc than
  the one that hit, or preview points that will not be awarded — a silent disagreement about game
  rules, which is what §35 exists to prevent.
- **Consequences:** A browser tab loaded before a content change is refused at the join boundary with
  the existing refresh/update message (D18) rather than desyncing. `CONTENT_VERSION` must be bumped
  whenever a content change would make a stale client disagree with the server about what a player
  sees or is awarded; a purely cosmetic change need not. The arena is content now (see D36), so map
  geometry changes are content-version changes.
- **Status:** Approved.

## D35. Protocol version 2; inventory commands stay separate messages

- **Date:** 2026-07-31.
- **Decision:** `PROTOCOL_VERSION` goes 1 to 2. The M4 message set is: join options
  (`MatchJoinOptions` = handshake plus `skillLoadoutIds`), `input` (with `secondaryAttackPressed`
  added), `secure_item`, and `discard_item` — each with a runtime validator, which discharges D23.
  Server to client is the synchronized `MatchState` schema plus one per-owner `player_private` message.
- **Reason:** The wire contract changed in ways an older peer cannot survive: a new room name, a new
  required handshake field, a new field on `InputMessage`, and two new message types. §14.2's shape is
  followed literally for the inventory commands (`{ type: "secure_item", sourceSlot: 2 }`) rather than
  folding them into `input`, because a one-shot command must not be resent twenty times a second
  while the key is held; `secondaryAttackPressed` *is* folded in, because it is a held-button state
  sampled every tick exactly like `attackPressed`, which `docs/PROTOCOL.md` §6's table already permits.
- **Consequences:** `docs/PROTOCOL.md` is updated to M4 status in the same change. Hit events are
  **not** broadcast: `stepSimulation` still produces them and the room still discards them, because no
  client renders them yet and a channel nothing consumes would be an empty layer. The §10.4 rule they
  exist to satisfy — never store short-lived effects in synchronized state — is preserved either way.
- **Status:** Approved.

## D36. `World` becomes multi-player; the simulation moves into the room unforked

- **Date:** 2026-07-31.
- **Decision:** `packages/simulation-core` moves behind the authoritative room without being forked,
  reimplemented, or duplicated. Making that possible required changing `World` itself:
  `World.player` becomes `World.players`, `Player` gains `id` and `runResult` (moved off `World`),
  `Projectile` gains `ownerId`, `stepSimulation(world, input)` becomes
  `stepSimulation(world, inputsByPlayerId)`, and `addPlayerToWorld`/`removePlayerFromWorld` are added.
  The arena moves out of the client scene into `@carry-or-fall/game-content` as an `ArenaDefinition`.
  An architectural test asserts `apps/client/src` contains no `stepSimulation`/`createSimulation`.
- **Reason:** M1 kept the simulation headless and out of Phaser scene code specifically so it could
  move behind a server room at M4, and that bet held for every *rule* module — movement, collision,
  dash, the whole `combat/` pipeline, inventory, build effects, skill effects, extraction, loot, skill
  chips, points, run results, and the PRNG all moved unchanged, because each was already a pure
  function over one actor plus world data. What did not hold was the *world shape*: `world.ts` said in
  as many words that it held "exactly one `player`, not a collection", because M1-M3 had no network
  and no other players. Two to eight players in one room is exactly the assumption that sentence
  encoded. The run result had to move to the player for the same reason: concept §17.1 ends the run
  "for that player", not for the match.
- **Consequences:** The change is recorded as a **modification, not a clean lift** — the honest
  version. `Projectile.ownerId` makes §13.4's cap 7 (active projectiles per player) count per owner,
  which is a strengthening: eight players can no longer collectively exceed a cap written per player.
  The chaser now retargets the nearest live player every step (concept §14.2's actual wording, which
  M1 could not exercise). Step order inside `stepSimulation` became a documented rule rather than an
  implementation detail, because a contested pickup must resolve identically everywhere.
- **Status:** Approved.

## D37. Client-side lag handling is interpolation only; prediction stays deferred

- **Date:** 2026-07-31.
- **Decision:** The client renders every entity — including the local player — by interpolating
  between the two most recent authoritative snapshots. There is no client-side prediction, no
  speculative local world, no rewind, and no reconciliation. The interpolation factor is clamped at 1,
  so a late patch holds the last position the server sent rather than extrapolating past it.
- **Reason:** Technical plan §11.1 prescribes exactly this for the first implementation
  ("server-authoritative movement, client interpolation, optional immediate local animation response,
  no sophisticated client prediction") and §11.2 adds "do not implement prediction before basic
  multiplayer correctness." Predicting the local player would also require the client to run the
  movement rules, which is the second simulation D36 exists to prevent.
- **Consequences:** The local player's movement lags input by up to one server tick (50 ms) plus
  network latency. That cost is real and stated rather than hidden; whether it is acceptable is the
  measurement §11.2 defers until multiplayer is correct — which is what this milestone establishes.
  Adding prediction later is §11.2's five-step recipe and needs `InputMessage.sequence`, which already
  exists and is already enforced to be strictly increasing.
- **Status:** Approved.

## D38. The pre-run loadout is join options, not a lobby choice

- **Date:** 2026-07-31.
- **Decision:** `LoadoutScene` stays a local, non-persistent picker (D31), but pressing Enter now
  hands the selected **skill ids** to the room join as Colyseus join options. The server re-validates
  them with `createSkillLoadout` — the identical function the client's picker uses — inside `onAuth`,
  and refuses the join outright if the selection is illegal. The choice is fixed for the whole match.
- **Reason:** D7 makes one room one match and technical plan §8.3 starts the match together with late
  join disabled, so there is exactly one moment at which a loadout can be chosen: the join. Putting it
  in the join options means an illegal loadout never occupies a seat, matching how D18 already handles
  an incompatible version. Running the same validator on the trusted side is the point: the client's
  copy shows the player a legal choice; the server's copy is the authority (technical plan §33
  "loadout unlocks").
- **Consequences:** A player cannot change skills mid-match, which is what concept §8.3 ("selected
  before entering the match") already required. When M5 adds accounts, the same join option carries an
  account-backed loadout instead of an ad-hoc selection, and the unlock check joins the same gate.
- **Status:** Approved.

## D39. Disconnect: stationary and vulnerable; secure-slot loss consequence superseded

- **Date:** 2026-07-31.
- **Decision:** An unconsented disconnect keeps the player in the world for a short reconnect window
  (15 s). Their stored input becomes neutral, so they stand still, and they remain a valid target for
  contact damage. Reconnecting restores control; letting the window lapse removes them and drops their
  carried inventory on the ground for whoever is still playing. A deliberate leave removes them
  immediately, with the same drop. Reconnection is authenticated with Colyseus's own single-use
  reconnection token.
- **Reason:** This is technical plan §34.1's policy verbatim, including its explicit "do not make
  disconnected players invulnerable". §34.2's stronger requirement — a valid account token and a
  matching identity — cannot be met: there are no accounts until M5. The Colyseus token is issued to
  that socket and is not guessable by another client, which is the strongest identity that exists
  right now.
- **Original M4 consequence — superseded for the secure slot by D44:** An abandoned run was lost,
  including the secure slot, because M4 had no persistence (D9, D16, D22). That statement records
  what was true before M5 and is no longer the rule. M5 persists a secure reservation before the
  simulation can report success, and join-time recovery settles a reservation left pending by a
  crashed or abandoned room. **Normal carried inventory is still lost and dropped; the secured item
  is not.**
- **Status:** Approved for the disconnect, vulnerability, reconnect-window, and normal-inventory
  drop policy. **The secure-slot-loss consequence is superseded by D44.**

## D40. `foundation_room` stays alongside `match_room`, behind one shared handshake gate

- **Date:** 2026-07-31.
- **Decision:** The M0 connection-only room is kept, not replaced. Both rooms call one
  `authorizeHandshake` helper for the protocol/content version gate instead of each implementing it.
- **Reason:** Joining the match room now has consequences — it takes one of eight seats and starts a
  lobby countdown — so a probe that allocates no match and starts no simulation is a genuinely
  different capability, not a duplicate. It is what `BootScene` uses to report connection health
  independently of gameplay, and what a deployment health check (M8) will want. The one real argument
  for deleting it was drift: two rooms implementing the version gate twice would eventually disagree.
  That is removed directly by extracting the gate, which is a better outcome than deletion because the
  capability survives too.
- **Consequences:** Two registered rooms. A change to the join gate is made once. The foundation
  room's integration tests keep passing unchanged, which is itself evidence the extracted gate behaves
  identically.
- **Status:** Approved.

## D41. No player-versus-player damage in M4; death looting arrives anyway

- **Date:** 2026-07-31.
- **Decision:** M4 ships no player-versus-player damage: melee swings and projectiles resolve against
  enemies only. What does ship is concept §15.2's first three bullets — a dead player's normal
  inventory drops, the drops are visible and lootable by **any** player, and the secure slot is not
  dropped — plus contested extraction (§15.1's last bullet), where two players channelling the same
  point each progress and extract independently.
- **Reason:** Technical plan §38 M4's deliverable list does not include PvP, and concept §15 is a
  system with its own unbuilt rules (ambush, protection, group balance §16) whose numbers exist in
  neither document. Death looting and contested extraction, by contrast, are not new systems at all:
  they are what M2's ground loot and extraction already do once several players share one world, so
  excluding them would have taken deliberate extra work.
- **Consequences:** Players can compete for loot and extraction points but cannot hurt each other.
  Adding PvP damage later means letting the shared attack pipeline treat players as `AttackTarget`s
  — the shape is already right, since `AttackTarget` is a minimal damageable-circle interface — plus
  the balance decisions §15/§16 imply. `docs/M3_ISSUES.md`'s parenthetical grouping of PvP with "other
  players (M4)" is superseded by this entry.
- **Status:** Approved.

## D42. The browser suite configures itself; it never reads the gitignored `.env`

- **Date:** 2026-08-01.
- **Decision:** `apps/client/playwright.config.ts` supplies every variable the end-to-end suite needs
  through its `webServer` `env` blocks — `VITE_GAME_SERVER_URL` and `VITE_BUILD_VERSION` for the
  client, `PORT`, `ALLOWED_ORIGINS`, `GAME_BUILD_VERSION`, `LOG_LEVEL`, `MATCH_SEED`, and
  `MATCH_LOBBY_MS` for the server. The suite reads nothing from the repository-root `.env`. CI is
  narrowed to `push` on `main` plus `pull_request`, with a concurrency group keyed on
  `github.head_ref || github.ref`; the browser job gains `timeout-minutes: 25`, and the suite runs
  with `maxFailures: 3` and `retries: 0` in CI.
- **Reason:** The root `.env` is gitignored by policy (`DEVELOPMENT_RULES.md`: only `.env.example` is
  tracked), so it can never exist on a CI runner or a fresh clone. The suite depended on it for the
  client's `VITE_*` variables, and `loadClientEnv` correctly throws when they are absent — so in CI
  the client threw before it could connect, no authoritative state ever arrived, and all 29 tests
  that enter a match timed out identically after 33 minutes. **An automated suite may not depend on a
  file that policy forbids committing**; that is the durable rule this entry exists to record.
  Narrowing `push` removes a second defect found in the same run: an unrestricted `push` trigger plus
  `pull_request` ran the whole workflow twice for one commit, and the old concurrency group could not
  collapse them because `github.ref` differs between the two events for the same branch.
- **Consequences:** A fresh clone with no `.env` passes the suite; this is verified by renaming the
  local `.env` aside and re-running, and is the standard way to check any future change here. The
  suite's runtime dropped from roughly ten minutes to roughly four, because `MATCH_LOBBY_MS` removes
  eight seconds of countdown from every one of thirty tests — a human-timescale wait (concept §22.2)
  that a suite driving both clients itself has no use for. `MATCH_SEED` and `MATCH_LOBBY_MS` are
  server configuration, read from the environment like `PORT`; `apps/client/test/build.test.ts`
  asserts neither reaches the client production bundle, since a client that could set its own
  countdown or seed would be a client asserting a match rule (technical plan §5.1). Retries are off:
  the flake sources this suite had were each traced and fixed, so a failure is now information rather
  than noise to absorb.
- **Status:** Approved.

## D43. Server metrics; the e2e lobby window is sized from a measured join time

- **Date:** 2026-08-01.
- **Decision:** The server reports the technical plan §32.2 metrics it can produce — active rooms,
  average and maximum room tick duration, event-loop lag, heap and RSS — as one periodic structured
  log line (`apps/server/src/metrics.ts`), and `apps/server/test/match-lifecycle.test.ts` asserts that
  matches created and abandoned in sequence dispose and leave step timing flat. Separately, the
  browser suite's `MATCH_LOBBY_MS` is set to **5000**, chosen from a measurement rather than picked.
- **Reason:** A browser test that ran 17s alone took 49s inside the full suite, and the obvious
  suspicion — abandoned rooms still running their 50 ms step loop — needed measuring rather than
  arguing about. It was wrong: rooms peak at 4 (bounded overlap from the reconnect window) and end at
  0, and tick time, event-loop lag, and memory were all flat or better late in a session than early.
  The real cause was the lobby window. The countdown starts on the first join and the room locks when
  it expires (§8.3), so it is the whole window for a *second* browser to reach the same match; that
  join measures 620-930 ms, and a previously-chosen one-second lobby left as little as 70 ms of
  margin. Under full-suite load the second client missed it, the two clients landed in **different
  matches**, and assertions about the other player waited out their timeouts. Verified by shrinking
  the window to 300 ms, where the clients split on every attempt.
- **Consequences:** The metrics exist because "is the server still healthy after a while" is a §38 M8
  requirement, and without them a degrading server is invisible until a user notices; they cost two
  counters and a periodic log line. The 5000 ms lobby costs roughly three minutes across thirty tests
  (the suite runs ~8 minutes rather than ~5), which is the price of not depending on a race — and
  `joinSameMatch` now asserts the two clients landed together, so if the window is ever too tight
  again the failure names that cause immediately. `MATCH_LOBBY_MS` remains server configuration;
  `apps/client/test/build.test.ts` asserts it never reaches the client production bundle.
- **Status:** Approved.

## D44. The secure-slot promise is honored by ordering, not by discipline

- **Date:** 2026-08-01.
- **Decision:** Supersedes D27 and D39's M4-era secure-slot-loss consequence. A secure-slot
  insertion is persisted before it is reported
  successful, as `docs/DEVELOPMENT_RULES.md` requires. The ordering is structural rather than a
  convention someone must remember (`docs/DATA_MODEL.md` §4.2): the room validates the request
  against live simulation state, writes an idempotent `secure_reservations` row and **awaits** it,
  and only then hands the secure intent to the next simulation step. The one channel that tells a
  client its secure slot is full is the private-state message derived from simulation state, and
  the simulation is not given the intent until the write returns — so there is no code path that
  reports success and then writes, and therefore no window for a crash to fall into.
- **Reason:** Technical plan §14.3 states the requirement and the failure it prevents. Making it an
  ordering rather than a check means it cannot be eroded by a later change that "optimistically"
  updates the client, because no such update exists to erode.
- **Consequences:** A failed or hung reservation leaves the item in normal inventory and tells the
  player nothing, which is the truthful outcome — it drops on death, because it was not secured.
  Building this surfaced a real defect: an earlier version re-checked the source slot *before*
  handing over the intent, and a `discard_item` arriving in the same tick is applied first inside
  `stepPlayerAttacks`, so the item left the inventory, `secureItem` refused, and the reservation
  stayed `pending` — leaving recovery ready to award points for an item the player had thrown away.
  The reservation is now confirmed against what the simulation actually did, one tick later, and
  withdrawn otherwise (`MatchRoom.confirmSecureActions`). A player who leaves mid-write has their
  unconfirmed reservation withdrawn for the same reason.
- **Status:** Approved.

## D45. Identity is the verified token; a server with no project mints local identities

- **Date:** 2026-08-01.
- **Decision:** The client sends a Supabase access token as a join option and **nothing else about
  its identity**; the user id comes back out of `auth.getUser(token)`, on the server. A client never
  sends a user id, because an id it can send is an id it can choose. Verification is a call to
  Supabase Auth rather than a local signature check, because local verification needs a JWT/JWKS
  library — a dependency beyond the Supabase client, which this milestone is not authorized to add.
  Where no Supabase project is configured, a `LocalTokenVerifier` treats the presented token as an
  opaque identity (unverified, because there is nothing to verify against) and mints a fresh one for
  a tokenless client.
- **Reason:** §17.1's instant guest play needs an identity from the first visit, and §33's
  server-generated-ids rule means the client cannot supply it. Treating the token as the identity in
  the unconfigured mode — rather than ignoring it — makes that mode structurally the same shape as
  the real one, so returning-player behavior (crash recovery, §14.3) is exercised without
  credentials instead of being reachable only on a machine that has them.
- **Consequences:** One network round trip per join, at a boundary that already does network work
  and never on the 50 ms step. The unconfigured mode is not a security fallback and is not reachable
  in production, because a production server without Supabase refuses to start (D46). A refused join
  carries `UNAUTHORIZED_JOIN_CODE` (4003), distinct from the version and invalid-message codes,
  because refreshing does not fix a locked skill and re-selecting a loadout does not fix an expired
  session.
- **Status:** Approved.

## D46. CI runs the seven gates with no credentials; only one suite needs a real project

- **Date:** 2026-08-01.
- **Decision:** All persistence is behind one `ProgressionStore` interface with two
  implementations: `SupabaseStore` and an in-process `MemoryStore` implementing the same contract,
  including both idempotency guarantees. The server selects Supabase when `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY` are present and the memory store otherwise, with a loud warning —
  and **`NODE_ENV=production` without Supabase is a startup failure**, so a deployment can never
  silently land on the fallback and discard every account's progression. The settlement assertions
  are written once, as a contract suite parameterized over the store, and run against the memory
  store in CI and against real PostgreSQL under a third vitest project, `pnpm test:supabase`, which
  **skips** without credentials rather than failing.
- **Reason:** D42's durable rule: an automated suite may not depend on a file policy forbids
  committing. The root `.env` is gitignored, so CI and a fresh clone have no credentials at all.
- **Consequences:** A fresh clone with no `.env` passes all seven gates — verified by renaming the
  local `.env` aside and re-running, which is the standard check here. The split in evidence is
  stated rather than blurred: the memory run proves the **server calls the contract correctly**;
  only the PostgreSQL run proves the **SQL implementing it is correct**, including
  `settle_match_reward`'s transactional and concurrency behavior and every row-level-security
  policy, none of which an in-process fake can demonstrate. Any report of this milestone says which
  claim rests on which run.
- **Status:** Approved.

## D47. Row-level security denies by absence; the `is_anonymous` claim gates preset slots only

- **Date:** 2026-08-01.
- **Decision:** RLS is enabled on all seven tables in the migration that creates them, never a
  follow-up. `profiles`, `point_balances`, `unlocks`, `loadouts`, and `match_results` grant a
  `select` policy for own rows only. `point_balances`, `unlocks`, `match_results`, `reward_ledger`,
  and `secure_reservations` have **no insert/update/delete policy at all**, so those statements are
  denied by absence rather than by a rule that could be written wrong; `reward_ledger` and
  `secure_reservations` additionally have no `select` policy. `loadouts` is the one client-writable
  table, gated on `user_id = auth.uid()` and on a slot allowance that reads the JWT's `is_anonymous`
  claim: one preset slot for anonymous accounts, three for permanent ones.
- **Reason:** Technical plan §18.3 lists what players may read and must not write. Anonymous users
  hold the same `authenticated` Postgres role as permanent users, so the role cannot distinguish
  them and only the claim can. Attaching the claim to preset slots rather than to progression is
  deliberate: an anonymous account earns, keeps, and spends progression identically — gating points
  or unlocks on it would punish the instant guest play §17.1 exists to protect — while presets
  beyond the first are a convenience for a durable account, which gives §17.3's warning something
  concrete to be about.
- **Consequences:** A browser writing `loadouts` is safe because a preset is a *preference*, not an
  entitlement: the server re-validates the selection at join through `createSkillLoadout` and the
  account's unlock set (D38, technical plan §19), so a client can store a junk preset and simply be
  refused. `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)` fails toward "permanent",
  because a missing claim on a linked account would otherwise restrict a paying user. All eight
  properties are tested against a real project in
  `apps/server/test-supabase/row-level-security.test.ts`, including a user failing to update
  **their own** balance and the claim tested in both directions.
- **Status:** Approved.

## D48. Unlocks are point thresholds; balances are never spent

- **Date:** 2026-08-01.
- **Decision:** M5's unlocks are thresholds on accumulated point balances, defined as data in
  `packages/game-content/src/unlocks.ts`. Balances only ever increase; there is no shop, no spend,
  and no refund. Five skills are default (concept §5.4, including D31's default loadout so a new
  account can legally play it) and five are earned, each mapped to the concept §6 category whose
  description names its effect. **Guard gets no unlock**, and that gap is asserted by a test.
- **Reason:** Technical plan §38 M5 lists "unlocks" as a deliverable, but concept §19.2–§19.4's
  three unlock *sources* — weapon blueprints, armor blueprints, boss skill cores — do not exist as
  content: there is no blueprint item kind, no armor system (§8.2), and no boss (M7). Inventing them
  inside a persistence milestone would be adding gameplay. Concept §6.1–§6.5 each say the category
  is "used to unlock or improve" specific content, which is a numeric basis that already exists.
  Spending is described nowhere, so adding it would be inventing a second system.
- **Consequences:** An unlock is a real gate, not a row nothing consults: `onAuth` refuses a loadout
  naming a skill the account has not unlocked (technical plan §19), tested in both directions.
  Guard's §6.4 unlock targets are armor types and shield skills — armor is unimplemented and the one
  shield skill (`bulwark_strike`) must stay a default for D31's loadout to be legal on a new account
  — so Guard points accumulate and count toward nothing until armor exists. Threshold amounts are
  proposed and balance-deferred like every other unsourced number. When M7 adds boss cores they
  become a second unlock source writing to the same table.
- **Status:** **Superseded by D67** (M7 created the boss-core source this entry anticipated). Kept
  because it is the record of what was true from M5 to M6, and because the threshold half of it is
  still in force.

## D49. With no persistence there is no progression to gate

- **Date:** 2026-08-01.
- **Decision:** A server running on the in-memory store provisions every account with **every**
  unlock, rather than concept §5.4's default set. The choice is made in `server.ts` from the same
  single fact that already chooses the token verifier — whether the store is Supabase-backed — and
  the client's unconfigured account mirrors it, so the picker and the server agree.
- **Reason:** Surfaced by the unlock gate working correctly: eight browser specs are M3's per-skill
  evidence for `piercing_rounds`, `returning_shot`, `homing_arrows`, and `stunning_blows`, all
  threshold unlocks, and every end-to-end run starts from a fresh account. Earning a threshold takes
  five to eight successful extractions, so the options were to delete that regression coverage, to
  weaken the gate for everyone, or to recognize that a threshold on an *accumulated* balance gates
  nothing when nothing accumulates across runs. A `DEV_UNLOCK_ALL` environment switch was written
  and then removed in favor of this: it was a second source of the same truth, and an entitlement
  knob is a worse thing to own than a stated consequence of having no database.
- **Consequences:** The gate itself is untouched — `onAuth` still refuses anything the account does
  not hold, and `join-gate.test.ts` and `settlement-adversarial.test.ts` pass
  `DEFAULT_UNLOCK_GRANTS` explicitly because they are *about* the gate and would otherwise assert
  nothing. A deployment cannot reach this path, because production without Supabase refuses to start
  (D46).
- **Status:** Approved.

## D50. Anonymous-user accumulation and sign-in rate limits are M8 obligations

- **Date:** 2026-08-01.
- **Decision:** Supabase does not clean up anonymous users automatically, and anonymous sign-in is
  IP rate-limited at 30 per hour by default. Neither is addressed in M5. M8 (private internet test)
  must decide, with measurements rather than guesses: whether CAPTCHA or Turnstile is needed
  (technical plan §17.4 says "CAPTCHA where recommended"), what the rate limit should be for real
  traffic, and how abandoned anonymous accounts — ones that never linked and never returned — are
  reaped.
- **Reason:** Neither matters while the game is unreachable from the internet: M5 is local, and D25
  plus §38 place the private internet test two milestones away. Adding a CAPTCHA provider now would
  also be an unapproved dependency, chosen with no traffic to size it against.
- **Consequences:** The obligation is recorded rather than discovered at M8. Two related choices
  already act on it: the browser suite blanks its own Supabase variables (D51), so thirty specs a
  run never spend the sign-in limit or leave junk users in a real project; and `profiles.status`
  exists with a checked value set, so the milestone that implements §17.4 has a place to write a
  restriction without a migration to reach it. `account_restrictions` (technical plan §18.1) is
  specified in `docs/DATA_MODEL.md` §3.8 but deliberately **not created**, because nothing in M5
  reads or writes one.
- **Status:** Reserved.

## D51. The browser suite blanks the Supabase variables, not merely omits them

- **Date:** 2026-08-01.
- **Decision:** `apps/client/playwright.config.ts` sets `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` to empty strings for the servers it
  starts, alongside the variables D42 already had it supply.
- **Reason:** Omitting them is not enough. The server's `dev` script loads the repository-root
  `.env` through `--env-file-if-exists` (D20), and Node does not override an already-set variable,
  so a developer *with* credentials ran a different suite than CI did — the exact divergence D42
  exists to prevent. This was not theoretical: the first M5 run of the browser suite failed on the
  developer's machine, on a `.env` value, and would have passed on a CI runner.
- **Consequences:** The suite runs on the in-memory store whether or not a `.env` exists, so it
  tests the game rather than a network round trip to a hosted database. It cannot spend the
  anonymous sign-in rate limit (D50) across thirty specs a run, and leaves no unrecoverable
  anonymous users in a real project. The real schema's evidence is `pnpm test:supabase`, which is
  the suite that *should* need credentials.
- **Status:** Approved.


## D52. Anonymous sign-in rate limit raised to 100/hour for the test suite

- **Decision:** The dashboard's anonymous sign-in rate limit was raised from the
  default 30/hour per IP to 100/hour so the 27-test Supabase suite can complete in
  one run. This is a production setting changed for a test convenience.
- **Reason:** Each test creates one or two anonymous accounts, exhausting the
  default limit at test 23. The proper fix is in the suite — reuse accounts where a
  fresh one is not needed, and delete the users a test creates — not in the limit.
- **Consequences:** Rate limiting is currently the only defense against anonymous
  sign-in abuse, since no CAPTCHA is configured. Before M8 opens the game to the
  internet, the suite must be fixed, this limit returned to 30 or lower, and CAPTCHA
  or Turnstile added per D50. Supabase never cleans up anonymous users, so test
  accounts accumulate against the 500 MB free tier until then.
- **Status:** Superseded. M6 reduced the suite to 5 sign-ins per full run, so the
  dashboard limit was returned to 30 on 2026-08-02. CAPTCHA or Turnstile remains an
  M8 obligation per D50.

## D53. The Supabase CLI is the tool that applies migrations; the dashboard verifies nothing

- **Date:** 2026-08-02.
- **Decision:** The Supabase CLI (`supabase`, installed per-developer, not a workspace dependency)
  is the approved way to apply `supabase/migrations/` to a real project. The sequence is
  `supabase link --project-ref <ref>` once, then `supabase db push` for every migration that has
  not been applied. The CLI's local state — `supabase/.temp/`, and `supabase/.branches/` if branches
  are ever used — is git-ignored **and** Prettier-ignored. The Supabase GitHub integration is
  **not** adopted.
- **Reason:** M5 shipped `supabase/migrations/` and was reported complete while the SQL had never
  been executed anywhere. Nothing in the repository's tooling applies a migration: `pnpm build`,
  `pnpm test`, and `pnpm test:integration` all run against the in-memory store, and
  `pnpm test:supabase` skips without credentials (D46). The gap was found by opening the dashboard
  and noticing the tables were absent — which is not a check, it is a coincidence. A named command
  that a person runs, recorded here, is the smallest thing that closes it.
  The GitHub integration would apply migrations on push, but that is deployment work and belongs to
  M8 (`docs/DEVELOPMENT_RULES.md`: no deployment during local milestones); its preview-branch
  feature also requires a paid plan, so adopting it now would buy a subscription for a milestone
  that does not need one.
- **Consequences:**
  - **Applying and verifying are two steps, and only the second is evidence.** `supabase db push`
    reports what it sent; `pnpm test:supabase` is what proves the schema is right, because it runs
    the contract and row-level-security suite against the live project (`docs/DATA_MODEL.md` §9).
    A milestone that touches `supabase/migrations/` is not complete until that suite has been run
    against a project the migrations were pushed to, and the run is reported with its counts.
  - This is deliberately outside CI. CI has no credentials and cannot reach a project (D46), so it
    can neither push nor verify; the obligation is on the person closing the milestone.
  - `supabase/.temp/linked-project.json` holds the project ref. It is per-developer state naming
    one project, never source, and must not be committed. It is listed in `.gitignore` *and*
    `.prettierignore` because Prettier does not read `.gitignore` — the file failed `format:check`
    before both entries existed.
  - `supabase init` has not been run and `supabase/config.toml` does not exist. `link` plus
    `db push` do not need one, and a config file describing a *local* Supabase stack would imply a
    Docker-based local database this project has not approved.
- **Status:** Approved.

## D54. A lost worker fails loudly; the real-server tests run one at a time

- **Date:** 2026-08-02.
- **Decision:** Two changes to how `pnpm test:integration` runs.
  1. `vitest.incomplete-run.ts` is a reporter registered for every Vitest run. If any test file
     finished the run without reporting a result, or any unhandled error escaped, it prints a
     block naming the missing files and sets a non-zero exit code.
  2. The six files that bind a real TCP port and run a real Colyseus server —
     `foundation-room`, `join-gate`, `match-authority`, `match-lifecycle`, `match-room`,
     `settlement-adversarial` — are a separate Vitest project, `integration-server`, with
     `fileParallelism: false`. `pnpm test:integration` runs both projects, so the gate and its
     name are unchanged.
- **Reason:** On Windows, a fork running `apps/server/test/match-room.test.ts` intermittently dies
  with exit code `3221226505` (`0xC0000409`, `STATUS_STACK_BUFFER_OVERRUN` — a Windows fail-fast).
  Measured, not assumed: no JavaScript exception, no unhandled rejection, no stderr byte, and no
  Node diagnostic report even with `--report-on-fatalerror`, so it is below Node's fatal handlers.
  It is not Vitest killing the worker either — a killed fork reports `signal=SIGTERM`, this one
  reports `code=3221226505, signal=null`.
  It is **load-sensitive**, which is the whole story: on an idle machine the suite passed 12 runs
  out of 12, and with 14 CPU-bound processes competing it crashed 2 runs out of 4. Thirteen files
  run in parallel, two of which spawn full production builds, so the suite oversubscribes the box
  on its own the moment anything else is running.
  What it produced was worse than a failure. Vitest's summary read `Test Files 12 passed (13)` and
  `Tests 148 passed (151)` — every visible word said "passed", and the file that vanished was
  invisible. `match-authority.test.ts` and `settlement-adversarial.test.ts` hold M4's and M5's
  adversarial exit criteria (technical plan §38), so that shape can report success while proving
  nothing about the claims the milestone rests on.
- **Consequences:**
  - The gate costs more wall time: about **198 s** where it was about **72 s**, because the six
    real-server files no longer overlap. That is the price of the mitigation and it is worth
    re-measuring if it becomes a burden — `maxWorkers` on the `integration-server` project is the
    dial, not removing the split.
  - Serialised, the suite passed 3 runs out of 3 under the same load that crashed it 2 out of 4.
    Three runs is not proof the crash is gone. The reporter is what makes that acceptable: the
    failure mode this decision actually eliminates is *not noticing*.
  - The root cause is still unattributed. It is below the JavaScript runtime, and identifying it
    would need a native debugger on the fork. If it recurs, the reporter names the file.
  - Related, found while investigating and **not** changed: `@colyseus/sdk` performs automatic
    reconnection on its own timers (enabled by default, `minUptime` 5 s, 15 retries with
    exponential back-off). After a test calls `room.leave(false)`, those timers can outlive the
    test and reconnect into whatever is listening next. It currently declines in every one of our
    tests because no room reaches 5 s of uptime before its unconsented leave, but a test that got
    slower would silently start reconnecting. A test that needs an unconsented drop to *stay*
    dropped should set `room.reconnection.enabled = false`.
- **Status:** Approved.

## D55. A party is seated atomically, and D8 is what makes that possible

- **Date:** 2026-08-02.
- **Decision:** A party's seats in a match room are allocated **all or nothing, in one synchronous
  step**. `MatchRoom#reserveGroupSeats` refuses unless the match has not started and every seat fits,
  records the party and the seat holds, and then calls `matchMaker.reserveMultipleSeatsFor` — with
  **no `await` between the check and the reservation**. `MatchQueue` serialises every allocation
  through one promise chain, so two parties queueing at the same instant are ordered rather than
  raced. **D8 does not change**; it gains this consequence.
- **Reason:** M6's exit criterion is "a party joins one room together", and the requirement is
  *every time*. D43 already measured the alternative: a second client takes 620-930 ms to reach the
  same match, and a lobby window sized from that measurement is still a race — under load, two
  clients landed in different matches. A window cannot be widened into a guarantee.
  Colyseus provides one. `Room#_reserveSeat` (`@colyseus/core@0.17.45`) evaluates
  `hasReachedMaxClients()` and assigns `this._reservedSeats[sessionId]` in one synchronous run, with
  no `await` between them, and it counts a reserved seat exactly like an occupied one. JavaScript is
  single-threaded and D8 keeps every room in that one thread, so a caller that performs its own
  capacity check and reaches `reserveMultipleSeatsFor` in the same continuation cannot be
  interleaved — not by another party, not by a solo `joinOrCreate`, not by a timer. **The constraint
  D8 imposes is the thing that makes group allocation atomic**, which is the opposite of the obvious
  reading of it.
- **Consequences:**
  - The 620-930 ms a browser takes to arrive is now spent against a seat nobody else can take,
    bounded by Colyseus's own 15 s seat-reservation timeout rather than by a countdown.
  - A match room **holds its `countdown`** while it has an unconsumed group seat, so a party never
    arrives to find the match already running (technical plan §8.3 disables late join). The hold has
    a deadline (`DEFAULT_GROUP_SEAT_HOLD_MS`, 10 s), so an absent member delays a match rather than
    preventing one.
  - A party is **never split**: a room that cannot seat all of them is declined outright and the
    queue takes the next candidate, creating one if none fits. A party of three offered a room
    holding six goes elsewhere, together.
  - **The cost, stated where it will be found:** `apps/server/src/party/match-queue.ts` and
    `MatchRoom#reserveGroupSeats` are the only code whose correctness rests on there being one
    process. A second replica breaks them and nothing else in the party subsystem; the rewrite is to
    move seat allocation behind Colyseus presence, which is exactly the coordination D8 defers. Both
    modules say so in their own doc comments.
  - The capacity check reads Colyseus's own `_reservedSeats`, which is not public API.
    `party-queue.test.ts` asserts the accessor really sees an outstanding reservation, so an upgrade
    that renames the field fails a test instead of letting a party overcommit a room.
- **Status:** Approved.

## D56. Join codes: minted by the server, 40 bits, and bounded in time

- **Date:** 2026-08-02.
- **Decision:** A party join code is **8 characters over a 32-symbol alphabet** (Crockford base32:
  digits and uppercase letters without `I`, `L`, `O`, `U`), drawn per character from
  `crypto.randomInt`. It is minted **only by the server** — a client never proposes one — and it
  **expires 10 minutes after it is issued** (`PARTY_CODE_TTL_MS`) or when the party ends, whichever
  comes first. The leader mints a replacement with one keypress, and the previous code stops working
  immediately. A code is a party *address*, not a single-use ticket: reuse is bounded by the party
  cap of three (concept §15.3), so "already used" means "used until the party is full". This settles
  concept §34's open "party invitation method".
- **Reason:** This is a public repository (D25), so the argument is written down rather than assumed
  from the code's shortness.
  - **Entropy.** 32^8 is about 1.1 x 10^12 codes. Against even ten thousand simultaneously live
    parties, a guess lands with probability under 10^-8.
  - **Unpredictability.** `crypto.randomInt`, not `Math.random`, and nothing derived from a counter,
    a timestamp, a room id, or a user id — so observing one code says nothing about the next.
    `join-code.test.ts` asserts the *output*: full alphabet coverage, no duplicate across 20 000
    draws, and no shared prefix between consecutive draws beyond chance.
  - **Non-enumerability.** The code lives in Colyseus matchmaking metadata so `filterBy(["joinCode"])`
    can route a member to the right party. That is safe because there is nowhere to read it from:
    `@colyseus/core@0.17.45` exposes exactly one matchmaking route,
    `POST /matchmake/:method/:roomName`, with `exposedMethods` limited to
    `joinOrCreate | create | join | joinById | reconnect`, and **no room-listing route**;
    `@colyseus/sdk@0.17.43` has no `getAvailableRooms`. `party-room.test.ts` asserts this against the
    installed packages rather than trusting the reading.
  - **Indistinguishable refusals.** Unknown, expired, replaced, and full all return one code and one
    message, so a guesser learns nothing from a miss.
  - **Never disclosed.** The code appears in the party's own synchronized state and in **no** log
    line, metric, or error message.
- **Consequences:**
  - Two refusal codes exist for one refusal, and the reason is not cosmetic. Colyseus surfaces a
    matchmaking-time refusal as an **HTTP status** and a seat-consumption-time refusal as a
    **WebSocket close code**; a 4000-range value is not a legal HTTP status, and throwing one makes
    Colyseus's router fail while building the response — the client then receives an internal error
    and the message telling it what to do is lost. Found exactly that way.
    `PARTY_JOIN_REFUSED_CODE` (4004) is the socket code; `PARTY_JOIN_REFUSED_HTTP_STATUS` (403),
    `INVALID_JOIN_OPTIONS_HTTP_STATUS` (400), and `INCOMPATIBLE_CLIENT_HTTP_STATUS` (426) are the
    matchmaking ones, and `authorizeHandshake` takes the code to use so one gate serves both paths.
  - `validatePartyJoinOptions` **requires the `joinCode` property to be present**, null included.
    Colyseus builds its matchmaking filter from the properties a client actually sent, so an omitted
    `joinCode` would be an empty filter — which matches *any* party room. `PartyRoom#onJoin`
    re-checks the presented code against the room's own, so this is the first of two independent
    defences rather than the only one.
  - **Deferred to M8:** per-IP rate limiting of `POST /matchmake/...`, alongside D50's CAPTCHA
    decision. Entropy is the defence today; a bounded guessing rate is a deployment concern with no
    traffic yet to size it against.
- **Status:** Approved.

## D57. A party is a live connection group, not an account relationship

- **Date:** 2026-08-02.
- **Decision:** A party is one Colyseus room holding a roster, a leader, a code, and a queue status,
  and **nothing about it is persisted**: no Supabase table, no column, no migration, no row. It
  exists while its members' party-room connections exist. Members keep that connection open during a
  match, so a party survives a run and can queue again; a page reload ends the membership.
- **Reason:** The question M6 had to answer is whether a party persists across runs now that accounts
  exist. Per session, yes; per account, no — and the "no" is the load-bearing half. Technical plan
  §8.4 says outright "do not build guilds, friend lists, or social graphs initially", and an
  account-persistent party is a social graph with one edge. D31 and D38 also deliberately kept
  pre-run selection a local, non-persistent screen and carried the loadout as join options; a party
  that outlived the browser tab would be the lobby those decisions avoided, arriving through the side
  door.
  Keeping the connection open is what makes "across runs" true in the only sense M6 offers it, and it
  costs one socket per player that runs no simulation.
- **Consequences:**
  - `supabase/migrations/` is untouched by this milestone, so D53's "applying is not verifying"
    obligation does not attach to it. (`pnpm test:supabase` is still run, because M6 changes that
    suite — see D63.)
  - Party formation fits D31's screen rather than replacing it: the same local picker gains
    create/join/leave/queue, and the loadout chosen there is what the member carries into the match —
    validated at the party door, one step earlier than D38 put it, by the same `createSkillLoadout`
    and unlock checks.
  - A refresh loses your party. That is the honest cost of persisting nothing, and it is cheap to
    undo: the leader shares the code again.
  - What a member sees about another member is a display name and a connection light. No access
    token, account id, balance, unlock list, or inventory enters party state — the same "not in the
    document at all" treatment `MatchState` already gives private data.
- **Status:** Approved.

## D58. Party markers are private rendering, and grant no authority

- **Date:** 2026-08-02.
- **Decision:** The "shared visual identifiers" of concept §8.4 are delivered as `partyMemberIds` on
  the **per-owner `player_private` message** — the session ids of the recipient's own teammates who
  are in this match. The synchronized `MatchState` schema gains **no party field**. The client draws
  a marker over those ids and nothing else.
- **Reason:** Technical plan §10.3 requires private player data to be filtered, and this
  repository's way of filtering it is to keep it out of the document every client receives, so there
  is no rule to misconfigure (M4). A public party field would be the opposite: a broadcast of who is
  grouped with whom, to everyone in the room, and a filtering rule to get wrong later.
- **Consequences:**
  - A non-party player is told **nothing** — not a party id, not a colour, not a count.
  - A party member learns nothing it did not already have: the ids are of players already in the
    public snapshot, and they are the ids from its own party roster.
  - The marker grants **no authority**. It is drawn from a list the server sent; no message becomes
    valid or invalid because of it; deleting the rendering would change what is on screen and nothing
    else. `apps/server/test/architecture.test.ts` pins the two files that may mention
    `partyMemberIds` and asserts neither is the reconciler nor the schema.
  - Publishing party membership to *everyone* — so opponents can see a group coming, which concept
    §15.1's ambush decisions would find meaningful — is a gameplay choice neither authoritative
    document makes. It is not taken, because private is the choice that cannot leak.
- **Status:** Approved.

## D59. Player-versus-player damage is assigned to M7B, between the boss and the internet test

- **Date:** 2026-08-02.
- **Decision:** PvP damage — players resolving attacks against players — is scheduled as **M7B,
  "Player Combat and Group Balance"**, between technical plan §38's M7 (Boss and Rare Skill) and M8
  (Private Internet Test). It is **not** implemented in M6. Its scope: letting the existing shared
  attack pipeline treat players as `AttackTarget`s, spawn protection (concept §21.4), and the concept
  §16 solo/group balance rules that only mean something once a direct fight exists. Exit criteria: a
  player can kill a player and loot the drop; spawn protection cannot be exploited; a solo player's
  §16.1 advantages are measurable against a party's §16.2 ones.
- **Reason:** The two authoritative documents disagree by omission, and the gap is where work gets
  lost. Concept §15 is a full PvP system and §15.1 says PvP "is allowed and meaningful"; §33 lists
  "PvE and PvP coexist" as approved baseline. Technical plan §38 assigns it to **no milestone at
  all**, and D41 deferred it out of M4 without naming where it lands. Left alone, the most central
  tension in the concept document would arrive by accident or not at all.
  M7B specifically: it must come **after** M7, because the boss and its skill cores change what a
  player can bring to a fight and balancing against a moving target is wasted work; and **before**
  M8, because M8 is the first time strangers meet, concept §35's criteria 8 and 9 can only be
  *measured* with real players, and shipping the first external test with the game's central tension
  absent would make that measurement meaningless.
- **Consequences:** M6 ships no friendly fire, because it ships no fire between players at all. The
  shape is already right — `AttackTarget` is a minimal damageable-circle interface — so the work is
  the balance decisions §15/§16 imply rather than the plumbing. The lettered name places it between
  M7 and M8 without colliding with M7 issue identifiers such as M7.5 or renumbering M8/M9.
- **Status:** Reserved.

## D60. A party gets presence, not power; the §35 balance work is deferred with PvP

- **Date:** 2026-08-02.
- **Decision:** Being in a party grants **no mechanical advantage in M6**: no shared loot, inventory,
  points, or rewards; no revive; no party-only extraction behavior; no reduced enemy aggression; no
  friendly-fire exemption. The only in-match difference between a partied and a solo player is a
  marker drawn on the party member's own screen (D58). Concept §16.1's solo compensations — lower
  visibility, smaller PvE aggro radius, faster extraction, easier routes — are **not** implemented
  here and are deferred to D59's milestone.
- **Reason:** Concept §35's success criteria 8 ("solo players can survive without joining a party")
  and 9 ("parties are useful but not unbeatable") are the two this milestone could most easily
  break, so what M6 does about them is recorded rather than assumed.
  - *What could break them, and what is done:* a party could take a disproportionate share of a room
    (three of eight seats), and M6 does not cap parties per room — neither document asks for one, and
    a cap would be a guessed number. What M6 does instead is refuse to **split** a party, so a party
    that does not fit takes a new room rather than displacing solos from a full one. Queueing as a
    party is not faster than queueing solo: both create a room on demand.
  - *Why the compensations are deferred:* each is a simulation rule with a magnitude that appears in
    neither document, and §16.3's actual claim — "the game should not pretend one solo player and
    three coordinated players are equal in a **direct fight**" — is about a fight that does not exist
    until D59's milestone. Inventing those numbers inside a matchmaking milestone would be adding
    gameplay rules that could not be judged.
- **Consequences:** Concept §16.2's real group advantages — coordinated combat, protecting a carrier,
  controlling a contested extraction — are all emergent from three humans cooperating, which is what
  §16.3 wants, and none of them is coded. The balance question stays open and is now owned by a named
  milestone rather than by nobody.
- **Status:** Approved.

## D61. The production-persistence refusal moves to the seam that decides

- **Date:** 2026-08-02.
- **Decision:** `createGameServer` refuses to build a server when `NODE_ENV=production` and the store
  it was given is not Supabase-backed (`assertPersistenceSelected`). `index.ts` keeps
  `assertPersistenceConfigured` (D46), which fails earlier and more cheaply.
- **Reason:** Verified first, rather than assumed: `index.ts` **already** refused, and running
  `NODE_ENV=production` with no credentials exits non-zero with that message. What was genuinely
  missing is where the check lives. The two behaviors it exists to prevent — minting a fresh local
  identity per join (D45) and provisioning every unlock (D49) — are chosen inside `createGameServer`,
  from one fact: whether the store is Supabase-backed. An invariant enforced only in the process
  bootstrap is one that a second entry point walks past, and `createGameServer` is a public seam
  every integration test already uses.
- **Consequences:** Two guards for one rule, at two different distances from the consequence, which
  is the point. `production-persistence.test.ts` asserts the **named behaviors** rather than the
  guard's existence: no `LocalTokenVerifier` and no all-unlock provisioning can be selected under
  `NODE_ENV=production`. Development, test, and an unset `NODE_ENV` are untouched, so CI and a fresh
  clone are unaffected.
- **Status:** Approved.

## D62. Decision numbers are checked; the file is append-only

- **Date:** 2026-08-02.
- **Decision:** `apps/server/test/decisions-integrity.test.ts` asserts that every `D<n>` cited
  anywhere under `docs/` resolves to a `## D<n>.` heading in this file, that no number is duplicated,
  and that the headings run `1..N` in ascending order with no gap. **Entries are append-only:**
  superseding one is done *in place*, by marking it superseded (D26, D27), never by deleting it.
- **Reason:** This already went wrong. Commit `847fe83` ("docs: record D28") rewrote the tail of this
  file instead of appending to it and silently removed D26 and D27, while more than twenty passages
  across seven documents went on citing D27 — every one of them pointing at nothing. It survived two
  milestones and was found by reading, not by tooling; every gate passed the whole time. A gap in the
  numbering is the fingerprint of exactly that mistake.
- **Consequences:** The test passes the day it is written, and its value is entirely prospective —
  which its own module doc says plainly, so a green run is not mistaken for evidence that anything
  was checked this time. Adding a decision now means appending a heading with the next number; a
  renumbering or a deletion fails the gate. The citation pattern deliberately ignores `D-1`/`D-2`,
  which are M1's defect ids rather than decisions.
- **Status:** Approved.

## D63. The Supabase suite pools accounts and deletes them; D52 can be reverted

- **Date:** 2026-08-02.
- **Decision:** `apps/server/test-supabase/helpers.ts` gains a per-file pool of anonymous accounts.
  `acquireAccounts(n)` signs in only when the pool must grow and hands back accounts whose
  progression rows have been deleted; `releaseAccounts()` deletes every pooled auth user in the
  file's teardown; `reportSignIns()` prints the measured count. The row-level-security file keeps
  **fresh** sign-ins and says why.
- **Reason:** D52 raised a **production** rate limit — anonymous sign-ins, from 30 per hour to 100 —
  so a test suite could finish, and recorded in the same breath that the real fix was in the suite.
  Rate limiting is currently the only defence against anonymous sign-in abuse, since no CAPTCHA is
  configured (D50), so the limit is not a knob to spend on convenience. Supabase also never cleans up
  anonymous users, so every run left permanent rows behind.
  Isolation is preserved because of what the contract suite actually needs: *a user with no rows*,
  not *a user that did not exist a moment ago*. Wiping all seven tables gives exactly the starting
  state a fresh sign-in gives. The one thing reuse cannot survive is a test that changes the
  **account** rather than its rows — row-level-security property 7 links an anonymous account to a
  permanent one, which flips the `is_anonymous` claim for good — and that test asks for a fresh
  sign-in explicitly.
- **Consequences:** The suite's anonymous sign-ins drop from roughly three dozen per run to a handful
  (the measured count is reported with the milestone). The dashboard limit can return to 30, which
  closes D52. `PROGRESSION_TABLES` in the helper must list every table a test can write to: a table
  missing from it would let one test see the previous test's rows, which is the isolation this
  depends on.
- **Status:** Approved; D52 is discharged once the limit is lowered.

## D64. One reconnection policy per connection, stated rather than inherited

- **Date:** 2026-08-02.
- **Decision:** D54's recorded hazard is closed rather than avoided.
  - Server integration tests that need an unconsented drop to **stay** dropped go through one shared
    helper, `withoutAutoReconnect`, rather than each remembering to set the flag.
  - The client's **match** connection sets `room.reconnection.enabled = false`, because it already
    has an explicit single reconnect attempt written for technical plan §34.1's window.
  - The client's **party** connection leaves the SDK's reconnection **on**, knowingly: a party
    outliving a network blip is what a player wants. The panel shows the connection state, so a party
    that is quietly retrying does not look like a party that is fine.
- **Reason:** D54 found that `@colyseus/sdk` reconnects on its own timers — enabled by default, 15
  retries with exponential back-off — and declines only while a room has been up for less than
  `minUptime` (5 s). It recorded that our tests escaped it *only* because no room reached five
  seconds before its unconsented leave, and predicted that "a test that got slower would silently
  start reconnecting". M6 is where that stops being hypothetical: party rooms live for whole matches
  and the queue tests hold match rooms through a lobby, a hold, and a run.
- **Consequences:** `sdk-reconnection.test.ts` holds a room past `minUptime`, drops a client, and
  asserts the abandoned room really goes away — a room that came back would be the SDK dialling
  again. It also reads the SDK's own defaults, so an upgrade that changes them fails there instead of
  as a flake somewhere else. The client now has exactly one reconnection policy in force per
  connection rather than two racing.
- **Status:** Approved.

## D65. A boss core is loot carrying a core record, and its skill costs two slots

- **Date:** 2026-08-03.
- **Decision:** A boss skill core is a `LootDefinition` with `rarity: "boss"` carrying an optional
  `bossCore` record — concept §29.4's `temporarySkillId`, `permanentUnlockId`, `secureSlotAllowed`,
  `duplicateConversion` — rather than a new content kind with its own inventory type. Its own
  `points` are **zero**. The skill it grants, `split_return`, costs **two permanent skill slots**,
  which answers the question concept §34 lists as open and §11 raises as a possibility.
- **Reason:** A core is picked up, carried, dropped on death, looted off a body, secured, and
  converted on extraction — six behaviours that already exist and that a core must share exactly. A
  separate kind would have meant widening `Inventory`, `pointsFromLoot`, `run-result.ts`, the
  private-state message, and every pickup path, to arrive back at the behaviour loot already has.
  Concept §15.2's "another player can take it off your body" then needs no code at all, which is the
  strongest form of implementing it.
  Zero points is what keeps the milestone's first exit criterion demonstrable. If a core also
  carried ordinary points, a first core would award an unlock *and* points and a duplicate would
  award points, and the two branches would differ only in degree. With zero points the branches are
  categorically different: first → unlock, duplicate → `duplicateConversion`.
  Two slots follows D29's existing path rather than inventing one: `createSkillLoadout` already sums
  `slotCost` against `MAX_SKILL_SLOTS` and refuses, and `returning_shot` already proved it. The boss
  skill splits *and* returns — it is the strongest projectile skill in the game — so if anything is
  to cost two, this is.
- **Consequences:**
  - `ALL_BOSS_CORES` is deliberately not part of `ALL_LOOT`, because `ALL_LOOT` is the random drop
    table `chooseLootDrop` picks from and a core must only ever come from a boss. `boss.test.ts`
    asserts the two do not intersect; `findLoot` searches both, because crash recovery holds only an
    item id (`docs/DATA_MODEL.md` §3.3) and a secured core has to be resolvable from it.
  - A carried (not activated, not secured) core provides **no** passive power. Concept §11 option 2
    says a core "may provide passive temporary power" — permission, not a requirement — and
    inventing a number for it would have made the carry branch quietly the strongest of the three.
    What option 2 actually promises, that it stays lootable and can be extracted for the unlock, is
    real and tested.
  - Two two-slot skills now exist, so `skills.test.ts` asserts the *set* rather than the count: a
    third has to be a deliberate edit rather than a number ticking up.
- **Status:** Approved.

## D66. The first boss is leashed to a lair, and has no projectiles

- **Date:** 2026-08-03.
- **Decision:** `warden` occupies one fixed arena position and never travels beyond
  `leashRadiusPx` of it. It wakes when a player comes inside `aggroRadiusPx` and returns to its lair
  when they leave. All three of its attacks (concept §14.3's two normal plus one area) are melee
  arcs or radial bursts centred on the boss; **it fires no projectiles**.
- **Reason:** Concept §14.3 asks for a boss that attracts nearby players *and* creates optional PvPvE
  conflict. PvP damage is M7B (D59), so the second half cannot exist yet, and building it here
  would be doing that milestone's work under this one's name. A leash gives the first half without
  the second: the rare drop is worth walking to, and the threat is one a player chooses to enter
  rather than one that comes to them.
  Projectiles are the same boundary. A projectile that damages a *player* is exactly the plumbing
  M7B owns — widening `AttackTarget` to include players — and M7 stops short of it deliberately.
  §14.3's "support melee and ranged interaction" is about how a player engages the boss, and both
  weapons do.
  The leash is also a **testing** decision, and that is not a side effect. M6 measured the browser
  suite's timing margins and made them depend on server time rather than machine time; a roaming
  boss would have put them back on a moving target. A leashed boss cannot reach any route the suite
  walks, which is a by-construction bound rather than a budget a slower machine invalidates. The lair
  at `(1500, 250)` was chosen against those routes, not for flavour (`docs/M7_ISSUES.md` §1.8).
- **Consequences:** A ranged player can kite a boss that cannot shoot back. The area attack's reach
  (260 px, the longest of the three) and the boss's move speed are what make kiting cost real
  movement; both are proposed and balance-deferred like every other unsourced number here. When M7B
  widens `AttackTarget`, giving this boss a projectile attack is a content edit — a fourth entry in
  `attacks` with a new `kind` — and the fixed-triple type is the place that forces someone to
  re-read §14.3's "do not build a complex raid boss" before doing it.
- **Status:** Approved.

## D67. Boss cores are the second unlock source; D48 is superseded

- **Date:** 2026-08-03.
- **Decision:** Supersedes D48. Unlocks now have an explicit `source`: `"default"`, `"threshold"`,
  or `"boss_core"`. `split_return` is a boss-core unlock, granted by surviving a run with the core
  that names it — securing it, or extracting with it — and **granted by no balance, however large**.
  Point thresholds continue exactly as D48 described them for the five skills that use them.
- **Reason:** D48 recorded thresholds as the unlock mechanism *because* concept §19.2–§19.4's other
  two sources did not exist as content, and it named M7 as the milestone that would create one. That
  is now true, so the record is updated in place rather than left to disagree with the code (D62).
  The `source` field is explicit rather than inferred: through M6 a null `requires` meant "default"
  and a non-null one meant "threshold", and inferring three states from one nullable field is how a
  fourth source becomes a bug.
  A boss unlock being unreachable by any balance is the load-bearing half. If patience could buy it,
  concept §11's risk decision would be a shortcut to something a player was going to get anyway, and
  the three-way choice it describes would be about timing rather than risk.
- **Consequences:** Weapon and armor blueprints (§19.2–§19.3) remain unimplemented — there is still
  no blueprint item kind and no armor system (§8.2) — so D48's Guard gap is unchanged and closes with
  armor, exactly as it said. `unlocksEarnedAt` keeps returning thresholds only; boss unlocks join the
  grant list at settlement, from the core, and the two sources meet nowhere else.
- **Status:** Approved. **Supersedes D48**, which is kept as the record of what was true from M5 to
  M6.

## D68. A duplicate core converts to points; mastery needs a mechanic before it needs a table

- **Date:** 2026-08-03.
- **Decision:** A boss core whose unlock the account already holds converts into progression points
  — the core's `duplicateConversion` — and grants no second unlock and no second inventory object.
  Concept §11's other option, mastery progress, is **not** implemented, and no mastery schema is
  added.
- **Reason:** Concept §11 offers "progression points **or** mastery progress"; §19.2–§19.4 repeat the
  same either/or. Points already exist, already settle idempotently, already feed thresholds, and
  need no migration — the conversion lands in `settle_match_reward`'s existing points path.
  Mastery would need a per-account, per-content-id level: a table, row-level-security policies of its
  own, an idempotency story, and a rule for what a level *does*. Concept §5.2 lists "limited mastery
  upgrades" and §30.1 asks for "modest mastery", but neither document says what a mastery level
  grants. Building the schema now would be inventing the mechanic in order to justify the table,
  which is the shape `docs/DEVELOPMENT_RULES.md` means by "do not create empty over-engineered
  service layers for future features that do not exist yet".
- **Consequences:** M7 touches no migration, so D53's "applying is not verifying" obligation does not
  attach to this milestone. The milestone that defines what mastery *grants* owns the schema, and a
  duplicate core is a natural first writer for it. Which branch a settlement takes — unlock or
  conversion — is decided once, from the account snapshot the room already holds, before the first
  write; a retry never recomputes it, and the store's idempotency means a recomputed classification
  could not be applied even if one happened.
- **Status:** Approved.

## D69. Knockback is scheduled to M7B, not deferred again

- **Date:** 2026-08-03.
- **Decision:** Supersedes D33's open-ended deferral. Knockback — concept §9.2's displacement-on-hit
  primitive, and the missing third of §9.4's Defensive Melee Combination — is scheduled into **M7B**
  (D59), alongside the PvP damage and concept §16 balance work.
- **Reason:** D33's stated reason has expired. It deferred knockback because covering §9.4's four
  example combinations needs eleven skills and technical plan §38 M3 scoped that milestone to "8 to
  10"; §38 M7 sets no skill count at all, so the range no longer binds anything.
  The deferral still holds, for a better reason. M7's rare skill is `split_return`, a **projectile**
  primitive; knockback is a **displacement** primitive. Landing both in one milestone means two new
  combat primitives alongside a boss, a new intent, and a settlement change — and displacement
  interacts with precisely what M7B exists to decide, since concept §16's solo-versus-group balance
  is about who controls space in a direct fight.
- **Consequences:** Three of §9.4's four combinations remain fully playable, unchanged from M3. The
  fourth is now owned by a named milestone rather than by "a later content milestone". Adding it
  remains the live check of the data-driven claim D33 described: a new primitive in
  `simulation-core` plus a content definition, and nothing else.
- **Status:** Approved. **Supersedes D33**, which is kept as the record of M3's reasoning.
