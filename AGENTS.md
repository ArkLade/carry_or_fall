# AGENTS.md

Instructions for Codex and other coding agents working in this repository.
Keep changes small, tested, and within scope.

## Authoritative documents

1. `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md` — gameplay and scope.
2. `docs/browser_multiplayer_game_technical_plan_verified_v2.md` — architecture, technology,
   security, testing, deployment.

Read both before planning. Do not modify either document during feature work.

## Shared rules

All durable rules live in **`docs/DEVELOPMENT_RULES.md`**. Read it first; it is the single
source of truth for architecture, security, scope, content, and testing rules. Approved
technology choices are recorded in `docs/DECISIONS.md`.

## Repository layout

```
apps/
  client/            Phaser 4 + Vite browser client (TypeScript)
  server/            Node.js 24 + Colyseus authoritative server (TypeScript)
packages/
  protocol/          Shared IDs, versions, message schemas, runtime validators
  game-content/      Data-driven content type placeholders (no gameplay content yet)
  simulation-core/   Deterministic helpers (no movement/combat yet)
  config/            Shared TypeScript / tooling config
docs/                Authoritative docs, rules, decisions, execution plans
.github/workflows/   GitHub Actions CI
```

This is a pnpm workspace monorepo. pnpm is run through Corepack (`corepack pnpm ...`).

## Required root commands

Run from the repository root:

- `pnpm dev` — start client and server together for local development
- `pnpm build` — production build of client and server
- `pnpm lint` — ESLint across the workspace
- `pnpm format:check` — Prettier formatting check
- `pnpm typecheck` — strict TypeScript type checking across all projects
- `pnpm test` — unit tests (Vitest)
- `pnpm test:integration` — Colyseus room integration / smoke tests

## Architecture boundaries (summary — see DEVELOPMENT_RULES.md)

- Server is authoritative. Clients send intent only; never trust client outcomes or rewards.
- Validate every client message at the network boundary.
- No in-run leveling, no level-up draft, no persistent ordinary-item stash.
- Content is data-driven. Preserve projectile/effect hard caps in shared code.
- Strict TypeScript. No secrets in source control.

## Scope

- Do not add unapproved frameworks, databases, caches, containers, or SDKs. The approved stack
  is in `docs/DECISIONS.md`; anything else needs a new recorded decision.
- Do not rewrite unrelated modules. Do not add unrequested systems or empty service layers for
  features that do not exist yet.
- Implement one milestone at a time.

## Completion requirements

Before declaring a task complete:

1. Add or update tests for every meaningful rule you touched.
2. Update documentation when architecture, commands, or behavior changed.
3. Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
   (plus `pnpm test:integration` when server behavior changed). All must pass.
4. Review the complete diff yourself and report limitations, assumptions, and anything left
   for the next milestone.

## Cloud and Git boundaries

- Do **not** push, deploy, or modify any cloud resource (Cloudflare, Railway, Supabase,
  GitHub environments) without an explicit instruction in the task.
- Do not commit unless explicitly asked. Do not rewrite Git history or force push.
- Never commit secrets. Real `.env` files are ignored; only `.env.example` is tracked.
