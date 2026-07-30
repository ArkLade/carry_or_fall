# Carry or Fall

A lightweight browser multiplayer extraction roguelite. This repository is a
strict-TypeScript **pnpm monorepo** with a Phaser browser client and an
authoritative Colyseus game server.

> **Milestone status: M0 — Repository Foundation.** This milestone establishes
> the toolchain, the client/server skeleton, and exactly one verified
> client-to-server connection. **There is no gameplay yet** (no movement,
> combat, enemies, loot, inventory, extraction, skills, or bosses). Gameplay
> begins at M1.

## Authoritative documents

The design and technical direction are fixed by two documents under `docs/`.
They are the source of truth; the code follows them, not the reverse.

- [`docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`](docs/lightweight_multiplayer_extraction_roguelite_game_concept.md)
  — the game concept.
- [`docs/browser_multiplayer_game_technical_plan_verified_v2.md`](docs/browser_multiplayer_game_technical_plan_verified_v2.md)
  — the verified technical plan.

Supporting control documents:

- [`docs/DEVELOPMENT_RULES.md`](docs/DEVELOPMENT_RULES.md) — durable rules.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — approved architecture decisions.
- [`docs/M0_EXECUTION_PLAN.md`](docs/M0_EXECUTION_PLAN.md) — the M0 plan.

## Prerequisites

- **Node.js 24 LTS** (the repo pins `>=24.0.0 <25`).
- **Corepack** (bundled with Node). It provisions the exact pinned pnpm
  version — you do **not** need a system-wide pnpm install.

Enable Corepack once per machine:

```powershell
corepack enable
```

All commands below are run from the repository root. pnpm `11.18.0` is pinned in
`package.json` (`packageManager`) and Corepack will use it automatically.

## Install

```powershell
pnpm install --frozen-lockfile
```

`--frozen-lockfile` matches what CI does and fails fast if the lockfile is out
of date. For day-to-day work `pnpm install` is fine.

## Configure environment

Copy the example env file and adjust if needed. The defaults work for local
development out of the box.

```powershell
Copy-Item .env.example .env
```

`.env.example` documents every variable (client `VITE_*` vars, server `PORT`,
`ALLOWED_ORIGINS`, `GAME_BUILD_VERSION`, `LOG_LEVEL`). It contains **no
secrets**; the real `.env` is git-ignored.

## Run locally

Start the client and server together:

```powershell
pnpm dev
```

This runs both workspaces in parallel:

- **Server** — authoritative Colyseus server on `http://localhost:2567`
  (HTTP health + WebSocket). Health check: `http://localhost:2567/health`.
- **Client** — Vite dev server on `http://localhost:5173`.

Open <http://localhost:5173>. The boot scene shows the title, the client build
version, and a live **server connection status** that transitions
`Connecting…` → `Connected` once the smoke-test room join succeeds. It also
displays the synchronized connected-player count from the server.

To run just one side:

```powershell
pnpm --filter @carry-or-fall/server dev
pnpm --filter @carry-or-fall/client dev
```

## Quality checks and tests

Each command mirrors a step in CI:

```powershell
pnpm run format:check   # Prettier — formatting must be clean
pnpm run lint           # ESLint (type-aware) across the workspace
pnpm run typecheck      # tsc --noEmit for every project
pnpm run test           # Vitest unit tests (packages)
pnpm run test:integration  # Vitest integration tests (server room + builds)
pnpm run build          # Production builds for client and server
```

Use `pnpm run format` to auto-fix formatting.

## Repository structure

```
Carry_or_Fall/
├─ apps/
│  ├─ client/     Phaser 4 + Vite browser client (boot scene, connection status)
│  └─ server/     Authoritative Colyseus server (foundation_room, health, shutdown)
├─ packages/
│  ├─ protocol/         Framework-agnostic client/server contract + validators
│  ├─ game-content/     Data-driven content definitions (type placeholders in M0)
│  ├─ simulation-core/  Deterministic simulation utilities (seeded PRNG in M0)
│  └─ config/           Shared TypeScript + ESLint base config (no runtime code)
├─ docs/          Authoritative + control documents
├─ .github/workflows/ci.yml   Format, lint, typecheck, test, build (no deploy)
├─ tsconfig.base.json         Shared strict compiler settings
├─ eslint.config.mjs          Flat ESLint config
├─ vitest.config.ts           Unit + integration test projects
└─ pnpm-workspace.yaml        Workspace + build-script allowlist
```

## What M0 includes / excludes

**Includes**

- pnpm workspace with pinned dependency versions and a single lockfile.
- Minimal Phaser client: one boot scene, build info, live connection status.
- Minimal Colyseus server: one `foundation_room`, join/leave logging,
  synchronized state (server build version + connected-player count), an HTTP
  health endpoint, env-var validation, structured logs, and graceful shutdown.
- Shared `protocol` package with version constants, message types, and runtime
  validators (the server never trusts arbitrary client input).
- Strict TypeScript, ESLint, Prettier, Vitest, and GitHub Actions CI.
- One verified local client-to-server connection.

**Excludes (deferred to later milestones)**

- All gameplay (movement, combat, enemies, loot, inventory, extraction, skills,
  bosses).
- Persistence / accounts (Supabase), deployment (Cloudflare Pages, Railway),
  horizontal scaling (Redis / multi-process presence), and mobile support.

## Troubleshooting

- **`pnpm` not found** — run `corepack enable`, then retry. Corepack ships with
  Node 24; no separate pnpm install is needed.
- **Client shows `Connection failed`** — ensure the server is running
  (`pnpm dev` starts both) and that `VITE_GAME_SERVER_URL` in `.env` points at
  the server (`ws://localhost:2567` by default). Confirm the server is up via
  `http://localhost:2567/health`.
- **Port already in use** — the client uses a strict port (`5173`) and will
  fail rather than pick another. Free the port or change `PORT` /
  `VITE_GAME_SERVER_URL` and the Vite port together.
- **Install fails on a build script** — pnpm 11 disables dependency build
  scripts by default. Approved ones are listed under `allowBuilds` in
  `pnpm-workspace.yaml`.

## Next milestone

**M1** begins gameplay on top of this foundation. Do not add gameplay to M0;
see [`docs/M0_EXECUTION_PLAN.md`](docs/M0_EXECUTION_PLAN.md) and the technical
plan for the milestone roadmap.
