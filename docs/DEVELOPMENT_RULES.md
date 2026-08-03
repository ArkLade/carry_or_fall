# Development Rules

Durable, shared rules for every coding agent and human working in this repository.
These rules apply across all milestones. `AGENTS.md` and `CLAUDE.md` both reference
this file so that guidance is defined once and never duplicated or contradicted.

## Authoritative documents

Two documents govern this project. Read them before planning or editing.

1. `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
   — authoritative for **gameplay and scope**.
2. `docs/browser_multiplayer_game_technical_plan_verified_v2.md`
   — authoritative for **architecture, technology, security, testing, and deployment**.

Do not modify either authoritative document as part of feature work. Changes to them
are a deliberate design act, made on their own.

## Architecture and authority

- The game is **server-authoritative**. The authoritative game server decides movement,
  combat, loot, death, and extraction.
- **Clients send intentions, never trusted outcomes.** A client may report which keys are
  pressed or which action the user requested. A client may never assert damage dealt,
  position reached, loot gained, cooldown completion, death, extraction success, or reward.
- **Runtime validation at network boundaries.** Every client message is validated for schema,
  numeric ranges, frequency, and allowed state before it is trusted.
- The server must not trust arbitrary client state.
- **Party membership is decided by the server**, never asserted by a client (technical plan §5.1
  lists "party membership authorization" among the things a browser must not decide). There is
  deliberately no join option or message field naming a party or another player, so there is no
  claim to validate away (`docs/DECISIONS.md` D55, D58). Do not add one.

## Progression and inventory rules (from the concept document)

- **No in-run leveling.**
- **No Archero-style random level-up draft.**
- **No persistent ordinary-item stash.** Ordinary extracted loot converts automatically; the
  player never returns to a lobby full of individual loot objects.
- **Permanent progression stores unlocks and points** (weapon/armor/skill unlocks, five point
  category balances, loadout presets, cosmetics, limited mastery), not hundreds of individual items.
- **Normal carried loot is temporary** — it powers the current run and is lost on death.
- **Secure-slot insertion is persisted before it is reported successful**, so a server crash
  cannot invalidate the protection promise. **Implemented in M5** (`docs/DECISIONS.md` D44,
  `docs/DATA_MODEL.md` §4.2) as an *ordering*, not a check: the room writes the reservation and
  awaits it, and only then hands the secure intent to the simulation — which is the only thing that
  can tell a client its secure slot is full. There is no code path that reports success and then
  writes, so there is no window for a crash to fall into. Do not add one.

## Content and code quality

- **Content is data-driven.** Adding an ordinary weapon, skill, or loot item should require a
  content definition plus tests, not a rewrite of the combat engine. Do not hard-code
  content-specific behavior unless a mechanic genuinely cannot use shared primitives.
- **Strict TypeScript** everywhere: `strict: true`, no implicit `any`, no disabled type checking,
  no unchecked network payloads.
- **Tests for every meaningful rule.** Do not write tests that merely assert a constant equals itself.
- **Preserve projectile and effect safety caps.** Hard caps (max projectiles, bounces, pierces,
  no recursive return/split, bounded search radius) live in shared combat code, not only in data.
  Never weaken or remove them casually.

## Security

- **No secrets in source control.** No credentials, API keys, or service-role keys in code,
  tests, fixtures, or generated documentation. Real `.env` files are git-ignored. A secret must
  also never reach a log line, an error message, or a report — including the "invalid
  configuration" errors that name it.
- Service-role / secret keys never appear in the browser bundle or in any `VITE_*` variable.
  **Prove it, do not intend it:** `apps/client/test/build.test.ts` asserts no secret-key value or
  server-only variable name survives a real production build, and
  `apps/client/test/architecture.test.ts` asserts no client source file can name one. This class of
  leak already happened once here (`docs/DECISIONS.md` D32) and went undetected for three
  milestones.
- **Row-level security is enabled in the migration that creates a table**, never a follow-up. A
  table that exists for one deployment without it was readable by every authenticated user.
- Never trust client-supplied reward or progression data. There is deliberately no client → server
  message capable of expressing a reward, a point value, an unlock, or an outcome, so there is no
  claim to validate away (`docs/DATA_MODEL.md` §6). Do not add one.

## Scope discipline

- **No unapproved frameworks.** The approved stack is recorded in `docs/DECISIONS.md`. Adding a
  framework, database, cache, container system, or SDK outside that list requires a new decision.
- **No unrelated rewrites.** Do not refactor or rewrite modules unrelated to the current task.
- **No premature microservices.** One authoritative game-server process; no microservice split.
- **No deployment during local gameplay milestones.** Deployment work happens only in its
  designated milestone, never as a side effect of gameplay work.
- **Do not add unrequested systems**, and do not create empty over-engineered service layers
  for future features that do not exist yet.

## Documentation

- **Update documentation when architecture or behavior changes.** If a change alters commands,
  structure, protocol, or rules, update the relevant docs in the same change.

## Art and assets

- **Art direction is governed by the concept document, section 24 (Visual Direction).**
- **Asset delivery is governed by the technical plan, section 36 (Asset Delivery).**
- **Generated design artifacts** (concept art, mockups, exploratory design files) live **outside**
  `apps/` and `packages/` and are **excluded from lint, typecheck, and build**. They are never
  imported by application or package code.

## Milestones

- Implement one milestone at a time. M0 is the repository foundation only and implements **no
  gameplay**. Do not begin the next milestone's gameplay work inside a foundation task.
