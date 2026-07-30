# M0 Execution Plan — Repository Foundation

This plan is followed during M0 implementation. M0 establishes a clean, strict-TypeScript
monorepo with a minimal Phaser client, a minimal Colyseus authoritative server, shared
packages, tests, linting/formatting, CI, control documents, and **one verified local
client-to-server connection**. M0 implements **no gameplay**.

Authoritative sources: `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
(gameplay/scope) and `docs/browser_multiplayer_game_technical_plan_verified_v2.md`
(architecture/technology/security/testing/deployment). Durable rules: `docs/DEVELOPMENT_RULES.md`.
Approved technology: `docs/DECISIONS.md`.

## 1. Repository structure

```
Carry_or_Fall/
├─ apps/
│  ├─ client/                 Phaser 4 + Vite browser client
│  │  ├─ src/
│  │  │  ├─ config/env.ts      Typed client configuration (env vars)
│  │  │  ├─ network/connection.ts  Colyseus connection helper
│  │  │  ├─ scenes/BootScene.ts    Single boot scene (status UI)
│  │  │  ├─ vite-env.d.ts      Typed import.meta.env declarations
│  │  │  └─ main.ts
│  │  ├─ test/                 Integration test (production build)
│  │  ├─ index.html
│  │  ├─ tsconfig.json
│  │  ├─ vite.config.ts
│  │  └─ package.json
│  └─ server/                 Node.js 24 + Colyseus authoritative server
│     ├─ src/
│     │  ├─ config/env.ts      Env-var validation
│     │  ├─ rooms/FoundationRoom.ts  Connection-only room + synced state
│     │  ├─ rooms/FoundationState.ts Colyseus schema state
│     │  ├─ logger.ts          Structured JSON logging
│     │  ├─ server.ts          HTTP health endpoint + Colyseus wiring
│     │  └─ index.ts           Bootstrap: env load, listen, graceful shutdown
│     ├─ test/                 Integration tests (room smoke + production build)
│     ├─ esbuild.config.mjs    Production bundle (esbuild)
│     ├─ tsconfig.json
│     └─ package.json
├─ packages/
│  ├─ protocol/               Shared IDs, versions, schemas, validators (+ unit tests)
│  ├─ game-content/           Content type placeholders (no content)
│  ├─ simulation-core/        Deterministic helper + version (no combat)
│  └─ config/                 Shared tsconfig + ESLint/Prettier config source
├─ docs/                      Authoritative docs + rules/decisions/plan
├─ .github/workflows/ci.yml   CI pipeline
├─ AGENTS.md, CLAUDE.md
├─ package.json               Root workspace + scripts
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml             Committed lockfile
├─ tsconfig.base.json
├─ eslint.config.mjs
├─ .prettierrc.json, .prettierignore
├─ vitest.config.ts
├─ .gitignore, .editorconfig, .env.example
└─ README.md
```

Deviation from technical plan §6: that full structure also lists `packages/test-bots`,
`supabase/`, and additional docs (PROTOCOL.md, DATA_MODEL.md, etc.). Those belong to later
milestones (load testing, persistence, protocol design) and are intentionally omitted from M0.

## 2. Packages

- **protocol** — protocol version constant, build-version representation, shared identifiers
  (room name), typed client message definitions for M0, and runtime validators. Has unit tests.
- **game-content** — content-definition type placeholders only; documents that weapons, armor,
  skills, loot, enemies, and bosses are deferred. No content values.
- **simulation-core** — one small deterministic utility (seeded PRNG) and a version constant,
  suitable for tests; documents that authoritative simulation comes later.
- **config** — shared `tsconfig.base` reference and lint/format config source, to avoid
  duplication.

## 3. Dependency policy

- Pinned exact versions; no wildcard or floating (`latest`) ranges. Lockfile committed.
- Approved lines: Phaser 4.2.x, Colyseus 0.17.x, Node.js 24 LTS, compatible stable TypeScript,
  Vite, Vitest. Playwright only if genuinely required for the M0 smoke test — **not required**;
  the integration test drives a real listening server with the `@colyseus/sdk` client, backed by
  a manual browser check.
- Resolved pins: `phaser@4.2.1`, `@colyseus/core@0.17.45`, `@colyseus/ws-transport@0.17.13`,
  `@colyseus/schema@4.0.30`, `@colyseus/sdk@0.17.43`, `express@5.2.1`, `@types/express@5.0.6`,
  `esbuild@0.28.1`, `typescript@6.0.3`, `vite@8.1.5`, `vitest@4.1.10`, `eslint@10.8.0`,
  `@eslint/js@10.0.1`, `typescript-eslint@8.65.0`, `prettier@3.9.6`, `@types/node@24.13.3`,
  `tsx@4.23.1`, pnpm `11.18.0`.
- Forbidden in M0: React, Vue, Angular, Next.js, NestJS, Prisma, Supabase, Redis, Docker,
  Kubernetes, state-management frameworks, UI component libraries, physics engines,
  analytics/monitoring SDKs. **Express is the one exception**: it is a required transitive
  runtime dependency of `@colyseus/ws-transport` (imported statically) and also serves the
  `/health` route via the Colyseus `express` option. It is not used as a general web framework.

## 4. Configuration files

- `tsconfig.base.json` — strict base (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, etc.). Each project extends it with environment-appropriate libs.
- `eslint.config.mjs` — ESLint 10 flat config with `typescript-eslint` type-aware rules; ignores
  build output and generated design artifacts.
- `.prettierrc.json` + `.prettierignore` — formatting.
- `vitest.config.ts` — workspace projects for unit vs integration tests.
- `.editorconfig`, `.gitignore`, `.env.example`.

## 5. Root commands

`dev`, `build`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:integration`.
`pnpm dev` runs both apps via `pnpm --parallel -r run dev` (no extra orchestrator). All scripts
are Windows-compatible (chained with `&&`, executed by pnpm's script shell).

## 6. Tests

1. protocol version + build-version exports and shape.
2. runtime validation of the minimal client message schema (accept valid, reject malformed).
3. simulation-core deterministic helper (seeded PRNG reproducibility).
4. server health endpoint returns ok + build version.
5. Colyseus `foundation_room` accepts a valid client (integration).
6. synchronized connected-player count increments on join and decrements on leave.
7. room disposes when empty.
8. production builds complete for client (Vite) and server (esbuild), each exercised by a
   dedicated integration test and again by `pnpm build` in CI.

## 7. CI workflow

`.github/workflows/ci.yml`, on push and pull_request: checkout → Node 24 → enable Corepack/pnpm
→ `pnpm install --frozen-lockfile` → `format:check` → `lint` → `typecheck` → `test` →
`test:integration` → `build`. No deployment.

## 8. Acceptance criteria

- `pnpm install` produces a committed lockfile.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
  and `pnpm build` all pass locally.
- Client production build and server production build both succeed.
- A browser client connects to the local server, joins `foundation_room`, and shows
  Connecting → Connected (or Connection failed on error), plus server build version and live
  connected-player count.
- Server exposes an HTTP health endpoint.
- No secrets committed; no out-of-scope gameplay systems added.

## 9. Non-goals

No gameplay of any kind (movement, aim, combat, health, enemies, projectiles, loot, inventory,
secure slot, extraction, skills, bosses), no accounts, no Supabase, no persistence, no parties,
no matchmaking beyond joining the smoke-test room, no reconnect logic, no client prediction, no
deployment, no mobile controls, no artwork pipeline, no monetization. No empty service layers
for those future features.

## 10. Rollback procedure

All M0 work is additive on top of the initial commit (`48bd795`, the two authoritative docs).
Nothing is committed unless explicitly requested. To roll back:

- Discard uncommitted work: review with `git status`, then remove the created files/directories
  (`apps/`, `packages/`, `.github/`, root config files, and the new `docs/*.md` control files),
  leaving the two authoritative documents in `docs/` untouched.
- If changes were committed to a branch, revert with `git revert <sha>` or reset the branch to
  `48bd795` (only on an explicit request). Never force-push or rewrite shared history.
- Delete `node_modules/` and pnpm's store links with `pnpm -w exec rimraf` alternatives are not
  needed; simply removing `node_modules/` restores a clean tree.

## 11. Assumptions

- pnpm is provisioned via Corepack (bundled with Node 24); no system-wide pnpm install is made.
- The two authoritative documents keep their original long filenames; `AGENTS.md`/`CLAUDE.md`
  reference those actual filenames rather than the aspirational `GAME_CONCEPT.md`/
  `TECHNICAL_PLAN.md` names used illustratively in the technical plan.
- The browser client and server share the Colyseus 0.17 line — `@colyseus/sdk@0.17.43` client
  against a `@colyseus/core@0.17.45` server, with `@colyseus/schema@4.0.30` on both sides — so the
  connection is verified by the integration test rather than relying on cross-version wire
  compatibility.
- TypeScript is pinned to `6.0.3` (not 7.x) for compatibility with `typescript-eslint@8.65.0`.
