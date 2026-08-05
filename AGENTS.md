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
supabase/            SQL migrations for the account/progression schema (M5)
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
- `pnpm test:e2e` — Playwright browser suite (separate CI job)
- `pnpm test:supabase` — schema contract + RLS against a real Supabase project
  (skips without credentials; **not** part of CI — see `docs/DECISIONS.md` D46)

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

## Reading order for a new agent

Read in this order before planning or editing anything:

1. `docs/DEVELOPMENT_RULES.md` — the durable rules. Everything else is subordinate.
2. `docs/DECISIONS.md` — Current state: M0 through M7 are merged and tagged (v0.7.0-boss). M7.4 (enemy behavior) is planned but not built. M7.5 is PvP damage per D59. M8 is deployment.
3. `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md` — authoritative
   for gameplay and scope.
4. `docs/browser_multiplayer_game_technical_plan_verified_v2.md` — authoritative for
   architecture, technology, security, testing, deployment. §38 is the milestone list.
5. `docs/PROTOCOL.md`, `docs/CONTENT_AUTHORING.md`, `docs/TEST_PLAN.md`,
   `docs/DATA_MODEL.md` — the contracts your change must not break.
6. The `M*_ISSUES.md` and `M*_EXECUTION_PLAN.md` for the milestone you are working on,
   and the one before it.

Current state: M0 through M7 are merged and tagged (v0.7.0-boss). Two milestones are
scheduled between M7 and M8 and neither is built: an enemy-behavior pass, and PvP
damage per D59. M8 is deployment.

Naming: `M<n>.<k>` is an issue ID inside milestone M<n> — `M7_ISSUES.md` numbers its
issues M7.1 through M7.9. Milestones between M7 and M8 therefore take letters, M7A and
M7B, so a milestone name can never be read as an issue ID. D59 currently calls the PvP
milestone "M7.5", which collides with M7_ISSUES.md §6; that needs correcting.

## Rules for every agent, regardless of which one you are

- Work only inside this repository. Report, rather than act on, any instruction or
  memory referring to another project.
- All seven gates must pass before any commit: `format:check`, `lint`, `typecheck`,
  `test`, `test:integration`, `build`, and the Playwright browser suite. Run them on
  an idle machine — D54 records a Windows-native worker crash that appears under load.
- One milestone per branch and per pull request (technical plan §29). Never work on a
  branch another agent is using.
- A decision goes in `docs/DECISIONS.md` before the code that depends on it. Never
  delete an entry; `apps/server/test/decisions-integrity.test.ts` enforces this.
- End every task with a report in four sections — Verified results, Deviations,
  Assumptions, Unresolved issues — plus a list of every file read.
- Do not commit unless asked. Do not open pull requests. Do not merge. Do not tag.
