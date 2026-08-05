# Carry or Fall

A lightweight browser multiplayer extraction roguelite. This repository is a
strict-TypeScript **pnpm monorepo** with a Phaser browser client and an
authoritative Colyseus game server.

> **Milestone status: M7 shipped and tagged as `v0.7.0-boss`.** M0 through M7
> are delivered. M7A (enemy behavior) and M7B (PvP damage and group balance)
> are planned but not built; M8 is the private-internet deployment milestone.

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
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the client/server wire contract.
- [`docs/CONTENT_AUTHORING.md`](docs/CONTENT_AUTHORING.md) — the data-driven
  content contract.
- [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) — the testing layers.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — the persistent-data contract.
- Milestone documents: [M0 plan](docs/M0_EXECUTION_PLAN.md);
  [M1 issues](docs/M1_ISSUES.md) / [plan](docs/M1_EXECUTION_PLAN.md);
  [M2 issues](docs/M2_ISSUES.md) / [plan](docs/M2_EXECUTION_PLAN.md);
  [M3 issues](docs/M3_ISSUES.md) / [plan](docs/M3_EXECUTION_PLAN.md);
  [M4 issues](docs/M4_ISSUES.md) / [plan](docs/M4_EXECUTION_PLAN.md);
  [M5 issues](docs/M5_ISSUES.md) / [plan](docs/M5_EXECUTION_PLAN.md);
  [M6 issues](docs/M6_ISSUES.md) / [plan](docs/M6_EXECUTION_PLAN.md); and
  [M7 issues](docs/M7_ISSUES.md) / [plan](docs/M7_EXECUTION_PLAN.md).

## Prerequisites

- **Node.js 24 LTS** (the repo pins `>=24.0.0 <25`).
- **Corepack** (bundled with Node). It provisions the exact pinned pnpm
  version — you do **not** need a system-wide pnpm install.

Enable Corepack once per machine:

```powershell
corepack enable
```

> **Windows: `corepack enable` fails with `EPERM` / "operation not permitted".**
> `corepack enable` installs shims into the Node install directory (e.g.
> `C:\Program Files\nodejs`), which a non-elevated shell cannot write to. Choose
> one of:
>
> - Run it from an **Administrator** PowerShell, **or**
> - Install the shims into a user-writable directory that is already on your
>   `PATH` (the npm global bin usually is):
>
>   ```powershell
>   corepack enable --install-directory "$env:APPDATA\npm"
>   ```
>
> - Or skip the shims entirely and invoke pnpm through Corepack each time —
>   `corepack pnpm <args>` (e.g. `corepack pnpm install`). This needs no admin
>   rights and is what CI does after `corepack enable` on Linux.

All commands below are run from the repository root. pnpm `11.18.0` is pinned in
`package.json` (`packageManager`) and Corepack will use it automatically. If you
did not enable the shims, prefix each `pnpm …` command with `corepack `.

## Install

```powershell
pnpm install --frozen-lockfile
```

`--frozen-lockfile` matches what CI does and fails fast if the lockfile is out
of date. For day-to-day work `pnpm install` is fine.

## Configure environment

Copy the example env file. Its active defaults run the complete local game with
in-memory progression and no external account service.

```powershell
Copy-Item .env.example .env
```

`.env.example` documents every variable (client `VITE_*` vars, server `PORT`,
`ALLOWED_ORIGINS`, `GAME_BUILD_VERSION`, `LOG_LEVEL`, and the Supabase pairs). It
contains **no secrets**. The real `.env` is git-ignored; deployed environments
inject credentials through their host settings instead.

### Accounts and progression (optional locally)

From M5 the game can store permanent progression in Supabase. All four Supabase
variables are **optional for local development** and are commented out in the
example. Copying it verbatim therefore gives the supported in-memory mode: the
server and client agree that accounts are not configured, and the game is fully
playable. A fresh clone with no `.env` still passes every gate, but opening the
development client fails at startup with a message naming the missing
`VITE_GAME_SERVER_URL`; copy the example before running locally. See
[`supabase/README.md`](supabase/README.md) to point it at a real project, and
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for the schema.

To enable persistent accounts, replace the placeholder project URL and keys and
uncomment **all four** `VITE_SUPABASE_*` / `SUPABASE_*` lines. Do not uncomment
the placeholder values themselves. A partial server pair is rejected at startup
with an error naming the missing variable; a client/server project mismatch is
refused at join as an unverifiable session.

Two rules, both enforced by tests rather than by intention:

- The **publishable key** (`sb_publishable_…`) is designed to be in the browser
  bundle; row-level security restricts every table to the signed-in user's own
  rows.
- The **secret key** (`sb_secret_…`) bypasses row-level security and exists only
  in the server process. It is never `VITE_`-prefixed and never committed — this
  repository is public. `apps/client/test/build.test.ts` asserts no secret value
  or server-only variable name reaches the production bundle, and
  `apps/client/test/architecture.test.ts` asserts no client source file can even
  name one.

`NODE_ENV=production` without the server pair is a **startup failure**, so a real
deployment can never quietly fall back to in-memory storage and lose every
account's progress.

Both sides read this single root `.env`:

- The **client** (Vite) loads the `VITE_*` vars.
- The **server** loads `NODE_ENV`, `PORT`, `ALLOWED_ORIGINS`,
  `GAME_BUILD_VERSION`, and `LOG_LEVEL` via Node's `--env-file` (wired into the
  server `dev` and `start` scripts). The file is optional — with no `.env` the
  server falls back to the documented defaults — and any real environment
  variable takes precedence over the file, so a host can inject values directly.

## Run locally

Start the client and server together:

```powershell
pnpm dev
```

This runs both workspaces in parallel:

- **Server** — authoritative Colyseus server on `http://localhost:2567`
  (HTTP health + WebSocket). Health check: `http://localhost:2567/health`.
- **Client** — Vite dev server on `http://localhost:5173`.

Open <http://localhost:5173>. The client starts in `LoadoutScene`, where you can
choose unlocked skills, create or join a party, and press `Enter` to start a run.
The match then provides the shipped M7 loop: authoritative movement and combat,
loot and inventory, secure-slot extraction, account progression, parties, and
the Warden boss/core unlock. The original `foundation_room` and HTTP `/health`
endpoint remain infrastructure and test surfaces rather than the player-facing
startup flow.

If the client and server protocol versions disagree, the server refuses the join
and the client shows a refresh/update message instead of connecting.

To run just one side:

```powershell
pnpm --filter @carry-or-fall/server dev
pnpm --filter @carry-or-fall/client dev
```

To run the server the way a host does — from its built bundle, loading the root
`.env` via `--env-file`:

```powershell
pnpm --filter @carry-or-fall/server build
pnpm --filter @carry-or-fall/server start
```

### Playing with a party (M6)

Everything happens on the loadout screen, before a run starts:

| Key     | What it does                                                              |
| ------- | ------------------------------------------------------------------------- |
| `P`     | Create a party. The server mints an 8-character join code and shows it.    |
| `J`     | Join a party: type the code, `Enter` to submit, `Escape` to cancel.        |
| `L`     | Leave the party.                                                          |
| `R`     | Mint a fresh join code (leader only). The previous one stops working.      |
| `Enter` | Start a run. In a party, the **leader's** Enter starts the party's match.  |

A party holds up to three players (concept §15.3). When the leader starts the
match, the server reserves every member's seat in one room **before** anyone
connects, so the party always lands together rather than racing a lobby
countdown (`docs/DECISIONS.md` D55). Inside the match each member sees a small
marker over their own teammates and nobody else's.

Join codes expire ten minutes after they are issued, or when the party ends.
Nothing about a party is stored: it lasts as long as its members stay connected,
and a page reload leaves it (D57).

### The boss and its core (M7)

One boss — the Warden — stands in a lair in the arena's upper far quadrant. It is
**leashed**: it wakes when someone comes close, fights them, and walks home when
they leave, and it can never travel further from its lair than its leash radius.
Everything outside that circle is exactly as dangerous as it was before.

It has two melee attacks and one area attack, each with a visible wind-up drawn
as the shape that is coming, and it speeds up once below half health. A player
who reacts to the wind-up and leaves the shape is not hit.

Killing it drops a **boss core**, and picking one up is a decision with three
outcomes (concept §11), which the inventory panel spells out while you carry one:

| Choice                | Key                | What you get                                                     |
| --------------------- | ------------------ | ---------------------------------------------------------------- |
| Activate now          | `C`                | The rare skill for the rest of this run. Lost when you die.       |
| Carry it out          | walk to extraction | The permanent unlock — but the core drops if you die on the way.  |
| Put it in the secure slot | `Shift`+its slot | The permanent unlock, kept even if you die. No combat power.  |

You cannot combine them: activating takes the core out of your inventory, so
there is nothing left to secure. Carrying a second core after you already hold
the unlock converts it to points instead — the settlement screen names which core
it converted.

The unlock is `split_return`, a two-slot rare skill: your arrows split into two
on a hit, and return to you when they expire. Both are gated by the shared safety
caps — a split child cannot split again, and cannot return.

## Quality checks and tests

Each command mirrors a step in CI:

```powershell
pnpm run format:check   # Prettier — formatting must be clean
pnpm run lint           # ESLint (type-aware) across the workspace
pnpm run typecheck      # tsc --noEmit for every project
pnpm run test           # Vitest unit tests (packages)
pnpm run test:integration  # Vitest integration tests (server room + builds)
pnpm run build          # Production builds for client and server
pnpm run test:e2e       # Playwright browser suite (separate CI job)
```

Use `pnpm run format` to auto-fix formatting.

One suite is **not** part of CI and needs credentials:

```powershell
pnpm run test:supabase  # Contract + row-level-security suite, against a real project
```

It reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment and skips
when they are absent, which is what lets CI — which has no credentials — pass on
a fresh clone. It is the only evidence that the SQL in `supabase/migrations/` is
correct; everything else runs against an in-memory store that implements the same
contract. `docs/TEST_PLAN.md` §5 states which claim rests on which run.

## Repository structure

```
Carry_or_Fall/
├─ apps/
│  ├─ client/     Phaser 4 + Vite browser client (loadout, arena, results)
│  └─ server/     Authoritative Colyseus server (match, party, progression)
├─ packages/
│  ├─ protocol/         Framework-agnostic client/server contract + validators
│  ├─ game-content/     Data-driven skills, loot, enemies, boss, and arena
│  ├─ simulation-core/  Deterministic movement, combat, loot, and boss helpers
│  └─ config/           Shared TypeScript + ESLint base config (no runtime code)
├─ supabase/      SQL migrations for the account/progression schema (M5)
├─ docs/          Authoritative + control documents
├─ .github/
│  ├─ workflows/ci.yml      Format, lint, typecheck, test, build (no deploy)
│  ├─ workflows/codeql.yml  CodeQL code scanning
│  └─ dependabot.yml        Weekly dependency-update PRs
├─ tsconfig.base.json         Shared strict compiler settings
├─ eslint.config.mjs          Flat ESLint config
├─ vitest.config.ts           Unit + integration test projects
└─ pnpm-workspace.yaml        Workspace + build-script allowlist
```

## Troubleshooting

- **`pnpm` not found** — run `corepack enable`, then retry. Corepack ships with
  Node 24; no separate pnpm install is needed.
- **`corepack enable` fails with `EPERM` (Windows)** — the shims target the Node
  install dir, which needs admin rights. Run it from an Administrator shell, use
  `corepack enable --install-directory "$env:APPDATA\npm"`, or just prefix
  commands with `corepack ` (e.g. `corepack pnpm install`). See
  [Prerequisites](#prerequisites).
- **Client shows a refresh/update message** — the client's protocol version does
  not match the server's, so the server refused the join (technical plan §35).
  This normally means a stale browser tab against a newer server; refresh the
  page. During development, restart both sides so their build/protocol versions
  agree.
- **Client shows `Connection failed`** — ensure the server is running
  (`pnpm dev` starts both) and that `VITE_GAME_SERVER_URL` in `.env` points at
  the server (`ws://localhost:2567` by default). Confirm the server is up via
  `http://localhost:2567/health`.
- **Client health line shows `unreachable`** — the HTTP `GET /health` failed.
  Confirm the server is running and that its `ALLOWED_ORIGINS` includes the
  client origin (`http://localhost:5173` by default), since the health response
  is CORS-restricted to allowlisted origins.
- **Port already in use** — the client uses a strict port (`5173`) and will
  fail rather than pick another. Free the port or change `PORT` /
  `VITE_GAME_SERVER_URL` and the Vite port together.
- **Server refuses to start naming `SUPABASE_URL` or `SUPABASE_SECRET_KEY`** —
  the two must be set together, the URL must be the project's `https://…` URL,
  and the secret key must start with `sb_secret_` (a publishable key in that slot
  is refused, because the server would look configured and be unable to write).
  The error names the variable and never quotes its value. Unset both to run
  without accounts.
- **`Your session could not be verified` on join** — the server has a Supabase
  project configured and the client's session did not check out (expired,
  missing, or from a different project). Reload the page to sign in again. If the
  client has no Supabase configuration but the server does, they disagree about
  whether accounts exist: set the `VITE_SUPABASE_*` pair, or unset the server's.
- **`Your account has not unlocked: …`** — the selected loadout names a skill
  this account has not earned (technical plan §19). Pick an unlocked skill; the
  loadout screen marks locked ones and shows what each costs. A server running
  without Supabase grants everything, because nothing accumulates there
  (`docs/DECISIONS.md` D49).
- **Install fails on a build script** — pnpm 11 disables dependency build
  scripts by default. Approved ones are listed under `allowBuilds` in
  `pnpm-workspace.yaml`.

## Next milestone

**M7A (enemy behavior)** is next, followed by **M7B (PvP damage and group
balance)**. M7B was added by `docs/DECISIONS.md` D59 because technical plan §38
assigns player-versus-player damage to no milestone at all; it also carries the
knockback decisions D33 and D69. Then comes **M8 (private internet test)**. See
[`docs/M7_ISSUES.md`](docs/M7_ISSUES.md) for what the current milestone
deliberately left out, and the technical plan §38 for the roadmap.
