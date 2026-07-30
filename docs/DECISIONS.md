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
