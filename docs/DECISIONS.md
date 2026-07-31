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

## D9. Supabase reserved for later persistent account progression

- **Decision:** Supabase (Auth + PostgreSQL) will store permanent account progression.
- **Reason:** Instant guest play, optional linking, and progression storage (technical plan §2.4).
- **Consequences:** Supabase must never hold live match state. **Not implemented in M0** — no
  Supabase dependencies, variables, or code exist yet.
- **Status:** Reserved.

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
- **Status:** Reserved.

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