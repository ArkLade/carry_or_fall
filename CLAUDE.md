# CLAUDE.md

Instructions for Claude Code working in this repository. These mirror `AGENTS.md`; the shared
rules are defined once in `docs/DEVELOPMENT_RULES.md` so the two files never contradict.

## Authoritative documents

1. `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md` — gameplay and scope.
2. `docs/browser_multiplayer_game_technical_plan_verified_v2.md` — architecture, technology,
   security, testing, deployment.

Read both before planning. Do not modify either document during feature work.

## Shared rules

Read **`docs/DEVELOPMENT_RULES.md`** first — it is the single source of truth for architecture,
security, scope, content, and testing rules. Approved technology choices are in
`docs/DECISIONS.md`.

## Repository layout

```
apps/client/          Phaser 4 + Vite browser client (TypeScript)
apps/server/          Node.js 24 + Colyseus authoritative server (TypeScript)
packages/protocol/    Shared IDs, versions, message schemas, runtime validators
packages/game-content/  Data-driven content type placeholders (no gameplay content yet)
packages/simulation-core/  Deterministic helpers (no movement/combat yet)
packages/config/      Shared TypeScript / tooling config
docs/                 Authoritative docs, rules, decisions, execution plans
.github/workflows/    GitHub Actions CI
```

pnpm workspace monorepo. Run pnpm through Corepack (`corepack pnpm ...`).

## Required root commands

- `pnpm dev` — start client and server together
- `pnpm build` — production build of client and server
- `pnpm lint` — ESLint across the workspace
- `pnpm format:check` — Prettier formatting check
- `pnpm typecheck` — strict TypeScript type checking
- `pnpm test` — unit tests (Vitest)
- `pnpm test:integration` — Colyseus room integration / smoke tests

## Architecture boundaries (summary — see DEVELOPMENT_RULES.md)

- Server is authoritative. Clients send intent only; never trust client outcomes or rewards.
- Validate every client message at the network boundary.
- No in-run leveling, no level-up draft, no persistent ordinary-item stash.
- Content is data-driven. Preserve projectile/effect hard caps in shared code.
- Strict TypeScript. No secrets in source control.

## Scope

- Do not add unapproved frameworks or services; the approved stack is in `docs/DECISIONS.md`.
- Do not rewrite unrelated modules or add unrequested systems.
- Implement one milestone at a time.

## Completion requirements

1. Add or update tests for every meaningful rule you touched.
2. Update documentation when architecture, commands, or behavior changed.
3. Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`
   (and `pnpm test:integration` when server behavior changed). All must pass.
4. Review the complete diff and report limitations and assumptions.

## Cloud and Git boundaries

- Do not push, deploy, or modify any cloud resource without an explicit instruction.
- Do not commit unless explicitly asked. Do not rewrite history or force push.
- Never commit secrets. Only `.env.example` is tracked.
