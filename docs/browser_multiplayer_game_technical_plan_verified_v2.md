# Technical Development and Deployment Plan
## Lightweight Browser Multiplayer Extraction Roguelite

**Document status:** Verified technical baseline, revision 2  
**Audience:** Codex, Claude Code, developers, technical reviewers, and future implementation agents  
**Related design document:** `lightweight_multiplayer_extraction_roguelite_game_concept.md`  
**Research verification date:** 2026-07-29
**Revision note:** Rechecked against current official documentation. Hosting, Supabase key names, dependency pinning, and secure-slot crash persistence were corrected.  
**Goal:** Build and deploy a playable browser game that users can open through a normal web link, join alone or with friends, and play without installing software.

---


# 0. Verification Summary

The overall architecture is approved with the following corrections:

1. Railway Hobby replaces Render Starter as the primary small-alpha game-server host.
2. Render remains a valid fixed-price fallback, but its current Starter tier is approximately USD 10 per month with 256 MB RAM.
3. Supabase Free is suitable for development and an active alpha, but free projects pause after one week of inactivity.
4. Use Supabase publishable and secret keys rather than designing new code around the legacy anon and service-role key names.
5. Pin Phaser 4.2.x, Node.js 24 LTS, and Colyseus 0.17.x at initialization.
6. Keep exactly one game-server replica until Colyseus multi-process presence and matchmaking are deliberately implemented.
7. Secure-slot insertion must be persisted immediately so a server crash does not invalidate the promise that the item is protected.
8. The 8-player room size and 20 Hz server tick are conservative starting values that require load and play testing. They are not guaranteed production capacity.

The client/server/database separation remains the recommended architecture.

---

# 1. Executive Decision

Use the following initial production stack:

| Layer | Recommended technology |
|---|---|
| Browser game client | Phaser 4.2.x, TypeScript, Vite |
| Multiplayer game server | Node.js 24 LTS, TypeScript, Colyseus 0.17.x |
| Persistent accounts and progression | Supabase Auth and PostgreSQL |
| Client hosting | Cloudflare Pages |
| Game-server hosting | Railway Hobby, one persistent replica |
| Fixed-price hosting fallback | Render Starter |
| Source control and CI | GitHub and GitHub Actions |
| Unit and integration testing | Vitest |
| Browser testing | Playwright |
| Server-room testing | Colyseus test utilities |
| Load testing | Colyseus load-test tools plus purpose-built bot clients |
| Package management | pnpm workspaces |
| Local development | Docker optional, not required for first development |

This architecture is recommended because it separates the project into three understandable responsibilities:

1. **The browser client** renders the game and sends player intentions.
2. **The authoritative game server** decides movement, combat, loot, death, and extraction.
3. **Supabase** stores permanent account data after the server validates match outcomes.

The first public deployment can realistically cost approximately:

- Cloudflare Pages: free
- Supabase Free: free
- Railway Hobby game server: USD 5 monthly minimum, with total cost based on actual CPU, memory, and network usage
- Expected small-alpha game-server range: approximately USD 5 to USD 15 per month after resource limits are configured
- Optional custom domain: separate annual cost

The practical starting total is therefore approximately **USD 5 to USD 15 per month plus an optional domain**. This is an engineering estimate, not a provider guarantee. Actual cost must be monitored.

Render remains a valid fixed-price fallback. Its current Starter web service is approximately USD 10 per month, but its 256 MB memory allocation is tighter than desirable for a Node.js multiplayer process with several active rooms.

For Railway, deploy the game server as one persistent service, disable Serverless sleeping, set one replica, and set explicit CPU and memory limits. A sleeping game server is cheap, but it also produces the inspiring multiplayer experience known as “staring at a reconnect screen.”

---

# 2. Why This Stack Fits This Game

## 2.1 Phaser 4 for the Browser Client

Phaser is an open-source HTML5 game framework designed for JavaScript and TypeScript browser games.

It is appropriate because the game requires:

- top-down 2D rendering
- keyboard and mouse input
- sprite animation
- collision visualization
- particles and lightweight effects
- audio
- UI scenes
- WebGL browser rendering
- desktop and later mobile-browser support

Phaser avoids the deployment burden of Unity WebGL and provides a codebase that Codex and Claude Code can inspect, test, and modify directly as TypeScript.

Use the current stable Phaser 4 release at project initialization and pin it in the lockfile. Do not continuously upgrade dependencies during core development.

## 2.2 TypeScript Everywhere

Use TypeScript for:

- browser client
- game server
- shared protocol types
- content definitions
- simulation helpers
- test bots
- deployment scripts where appropriate

This reduces translation errors between client and server and helps coding agents reason about the codebase.

Strict compiler settings are required.

Recommended principles:

- `strict: true`
- no implicit `any`
- no unchecked protocol payloads
- tagged unions for game commands
- shared identifiers and constants
- runtime validation at all network boundaries

## 2.3 Colyseus for Multiplayer Rooms

Colyseus is an open-source Node.js framework built around:

- authoritative multiplayer rooms
- matchmaking
- room lifecycle
- state synchronization
- reconnect handling
- client libraries
- test utilities
- load-test tooling

This maps naturally to the game:

- one room equals one match
- each room has 8 players initially
- the room owns the match state
- the server owns enemies, loot, extraction, death, and rewards
- clients subscribe to synchronized state

Using Colyseus is simpler and safer than building raw WebSocket room management, state patches, reconnection, and matchmaking from scratch.

## 2.4 Supabase for Accounts and Progression

Supabase provides:

- PostgreSQL
- authentication
- anonymous users
- email or OAuth account linking
- row-level security
- database migrations
- server-side functions
- generated TypeScript types

This is appropriate for:

- instant guest play
- optional permanent account linking
- progression points
- weapon unlocks
- armor unlocks
- skill unlocks
- loadout presets
- match history
- reward settlement records

Supabase must not control live match state. Live matches remain in the Colyseus server’s memory.

## 2.5 Cloudflare Pages for the Client

The client is a static Vite build containing:

- HTML
- JavaScript
- CSS
- sprites
- audio
- configuration

Cloudflare Pages can host this globally with HTTPS and a free subdomain. A custom domain can be connected later.

The client deployment is independent from the game server.

## 2.6 Railway for the Game Server

Railway supports:

- persistent Node.js services
- WebSocket traffic
- Git-based deployment
- automatic SSL
- provider and custom domains
- selectable regions
- resource and cost limits
- logs and metrics

The recommended public-test configuration is Railway Hobby with:

- one persistent service
- Serverless sleeping disabled
- one replica only
- explicit CPU and memory limits
- one region close to the first tester population

One replica is intentional. Colyseus rooms live in the memory of one process. Adding replicas before configuring Colyseus presence, matchmaking coordination, and shared infrastructure can route players to different processes and create broken room behavior.

Render remains a valid fixed-price fallback, especially when predictable billing matters more than memory headroom.
---

# 2.7 Dependency Pinning

At repository creation, pin tested versions in the lockfile.

Initial verified choices:

- Phaser 4.2.x
- Node.js 24 LTS
- Colyseus 0.17.x
- current compatible TypeScript, Vite, Vitest, and Playwright versions

Do not use floating `latest` dependencies in production.

Upgrade dependencies only through a dedicated pull request that:

1. updates the lockfile
2. runs all tests
3. runs two-client multiplayer smoke testing
4. checks protocol compatibility
5. records any migration notes

---

# 3. Player Access Model

The public game should work as follows:

1. The player opens a URL such as `https://game.example.com`.
2. Cloudflare Pages serves the game files.
3. The browser starts or restores an anonymous Supabase session.
4. The lobby shows:
   - Play Solo
   - Create Party
   - Join Party Code
   - Loadout
   - Unlocks
5. The browser obtains an authentication token.
6. The browser connects securely to the Colyseus server through WSS.
7. The server validates the token.
8. The server loads the player’s approved loadout and unlock data.
9. The server places the player into a match room.
10. The match runs entirely under server authority.
11. At death or extraction, the server settles rewards in PostgreSQL.
12. The client displays the result and returns to the lobby.

The user installs nothing.

The initial browser promise should be:

> Works in current mainstream desktop browsers with a stable internet connection.

Do not claim support for every historical browser. Internet Explorer has endured enough, and so have we.

---

# 4. High-Level Architecture

```text
+---------------------------------------------------------+
|                     Player Browser                      |
|                                                         |
|  Phaser Client                                          |
|  - rendering                                            |
|  - input collection                                     |
|  - local UI                                             |
|  - interpolation                                        |
|  - audio                                                |
|  - prediction later                                     |
+----------------------+----------------------------------+
                       |
                       | HTTPS / WSS
                       v
+---------------------------------------------------------+
|                Authoritative Game Server                |
|                Node.js + Colyseus                       |
|                                                         |
|  Match Room                                             |
|  - player movement                                      |
|  - combat                                               |
|  - enemies                                              |
|  - projectiles                                          |
|  - loot                                                 |
|  - secure slot                                          |
|  - extraction                                           |
|  - death                                                |
|  - room lifecycle                                       |
|  - anti-cheat validation                                |
+----------------------+----------------------------------+
                       |
                       | HTTPS / PostgreSQL RPC
                       v
+---------------------------------------------------------+
|                  Supabase Project                       |
|                                                         |
|  Auth                                                   |
|  PostgreSQL                                             |
|  - profiles                                             |
|  - point balances                                       |
|  - unlocks                                              |
|  - loadouts                                             |
|  - match results                                        |
|  - reward ledger                                        |
+---------------------------------------------------------+
```

Static game files do not pass through the game server.

Persistent account writes do not come directly from untrusted match clients.

---

# 5. Trust and Authority Model

## 5.1 Client Responsibilities

The browser client may decide:

- what keys are currently pressed
- where the player is aiming
- which menu button the user selected
- which inventory move the user requested
- how to render known game state
- how to interpolate remote entities
- local cosmetic settings

The browser client must not decide:

- actual position
- damage dealt
- enemy health
- loot ownership
- loot values
- secure-slot success
- death
- extraction completion
- point rewards
- unlock rewards
- cooldown completion
- projectile hits
- party membership authorization

## 5.2 Server Responsibilities

The game server is authoritative for:

- movement validation
- collision
- attack cooldowns
- projectile creation
- hit detection
- damage
- enemy AI
- loot spawning
- inventory contents
- secure slot
- extraction timers
- death
- room results
- reward settlement

## 5.3 Database Responsibilities

PostgreSQL is authoritative for:

- account identity
- permanent points
- permanent unlocks
- loadouts
- match reward records
- account restrictions
- progression history

## 5.4 Golden Rule

Never accept a message such as:

```json
{
  "type": "add_points",
  "force": 5000
}
```

from a client.

The client requests actions. The server calculates consequences.

---

# 6. Recommended Repository Structure

Use a monorepo.

```text
game-project/
├─ apps/
│  ├─ client/
│  │  ├─ src/
│  │  │  ├─ scenes/
│  │  │  ├─ entities/
│  │  │  ├─ rendering/
│  │  │  ├─ input/
│  │  │  ├─ ui/
│  │  │  ├─ audio/
│  │  │  ├─ network/
│  │  │  └─ main.ts
│  │  ├─ public/
│  │  └─ vite.config.ts
│  │
│  └─ server/
│     ├─ src/
│     │  ├─ rooms/
│     │  ├─ simulation/
│     │  ├─ systems/
│     │  ├─ auth/
│     │  ├─ persistence/
│     │  ├─ validation/
│     │  ├─ telemetry/
│     │  └─ index.ts
│     └─ render.yaml
│
├─ packages/
│  ├─ protocol/
│  │  ├─ messages.ts
│  │  ├─ state.ts
│  │  └─ validators.ts
│  │
│  ├─ game-content/
│  │  ├─ weapons.ts
│  │  ├─ armors.ts
│  │  ├─ skills.ts
│  │  ├─ loot.ts
│  │  ├─ enemies.ts
│  │  └─ bosses.ts
│  │
│  ├─ simulation-core/
│  │  ├─ math/
│  │  ├─ combat/
│  │  ├─ inventory/
│  │  ├─ extraction/
│  │  └─ random/
│  │
│  ├─ test-bots/
│  └─ config/
│
├─ supabase/
│  ├─ migrations/
│  ├─ seed.sql
│  └─ functions/
│
├─ docs/
│  ├─ GAME_CONCEPT.md
│  ├─ TECHNICAL_PLAN.md
│  ├─ PROTOCOL.md
│  ├─ DATA_MODEL.md
│  ├─ CONTENT_AUTHORING.md
│  ├─ TEST_PLAN.md
│  └─ OPERATIONS.md
│
├─ .github/
│  └─ workflows/
│
├─ AGENTS.md
├─ CLAUDE.md
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ README.md
```

---

# 7. Shared Code Strategy

## 7.1 Share Definitions, Not Authority

The following may be shared between client and server:

- type definitions
- message schemas
- item IDs
- weapon IDs
- skill IDs
- animation labels
- display metadata
- deterministic math helpers
- constants required for rendering
- effect caps

Do not share private server information such as:

- hidden loot spawn tables
- anti-cheat thresholds
- secret keys
- service credentials
- unrevealed enemy targets
- hidden players outside visibility range

## 7.2 Content Separation

Content should be data-driven.

Example:

```ts
export const weapons = {
  basicBow: {
    id: "basic_bow",
    category: "ranged",
    baseDamage: 10,
    attackIntervalMs: 650,
    projectileSpeed: 600,
    tags: ["projectile"],
    limits: {
      maxProjectiles: 8,
      maxBounces: 3,
      maxPierces: 3,
    },
  },
} as const;
```

Adding a normal weapon or skill should usually require:

- content definition
- icon
- optional visual effect mapping
- tests

It should not require rewriting the combat engine.

---

# 8. Multiplayer Room Model

## 8.1 One Match Per Room

Each Colyseus room represents one complete match.

Initial room settings:

- maximum 8 players
- optional parties up to 3
- one map
- one boss
- fixed maximum duration
- two rotating extraction points

Later:

- 12 players after load tests
- 20 players only after simulation and bandwidth evidence

## 8.2 Room Lifecycle

```text
CREATING
  |
  v
WAITING_FOR_PLAYERS
  |
  v
COUNTDOWN
  |
  v
RUNNING
  |
  +--> PLAYER_EXTRACTED
  |
  +--> PLAYER_DIED
  |
  v
ENDING
  |
  v
DISPOSED
```

## 8.3 Match Creation Strategy

Recommended first implementation:

- short queue
- server creates room
- players join during a brief lobby
- match starts together
- late join disabled

This is easier to balance and debug than continuous join-in-progress.

Join-in-progress can be considered later.

## 8.4 Party Joining

Initial party system:

1. Party leader creates a party.
2. Server returns a short code.
3. Friends enter the code.
4. Party members enter matchmaking together.
5. Maximum party size is three.
6. Party members receive shared visual identifiers.
7. Each member keeps individual loot and progression.

Do not build guilds, friend lists, or social graphs initially.

---

# 9. Simulation Loop

## 9.1 Initial Tick Rate

Recommended starting point:

- server simulation: 20 ticks per second
- client input messages: capped at 20 per second
- client rendering: browser refresh rate, normally 60 frames per second
- remote entity interpolation: between server states

These values are starting assumptions and must be measured.

## 9.2 Why Not 60 Server Ticks

A 60 Hz authoritative server would:

- triple simulation work
- increase network traffic
- increase hosting cost
- complicate scaling

This game has simple top-down combat and does not initially require competitive-shooter precision.

## 9.3 Fixed-Step Simulation

Use a fixed simulation step.

Do not calculate authoritative movement using arbitrary client frame times.

Example:

```text
simulation_dt = 50 ms
```

The server:

1. receives input intent
2. stores the latest valid input
3. advances the fixed simulation
4. applies movement and attacks
5. updates enemies and projectiles
6. resolves collisions
7. updates extraction and death
8. publishes state changes

## 9.4 Randomness

Use server-generated randomness.

For testability:

- give each match a random seed
- use a controlled pseudo-random generator for loot and spawning
- record the seed with match results
- do not use client randomness for authoritative outcomes

Full deterministic replay is not required for the first version, but reproducible seeded tests are strongly recommended.

---

# 10. Network Protocol

## 10.1 Client-to-Server Messages

Suggested messages:

```text
input
attack
dash
interact
inventory_move
secure_item
equip_ground_weapon
replace_wildcard_skill
ping
```

Prefer compact messages and avoid sending large JSON objects repeatedly.

## 10.2 Input Message

Example conceptual payload:

```ts
type InputMessage = {
  sequence: number;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aimAngle: number;
  attackPressed: boolean;
  dashPressed: boolean;
  interactPressed: boolean;
};
```

The server validates:

- numeric ranges
- message frequency
- sequence order
- allowed action state
- cooldowns
- player status

## 10.3 Server-to-Client State

Synchronized state may include:

- player ID
- position
- facing
- health
- alive status
- weapon type
- armor type
- visible skills
- inventory summary for local player
- enemy positions
- projectile positions
- loot positions
- extraction state
- match timer
- party markers

Private player data must be filtered.

Other clients do not need to receive another player’s complete inventory.

## 10.4 One-Shot Events

Use transient events for:

- hit effects
- sounds
- damage numbers
- extraction start
- extraction interruption
- loot pickup animation
- death effect

Do not store every short-lived effect permanently in synchronized room state.

---

# 11. Movement and Latency

## 11.1 First Implementation

Begin with:

- server-authoritative movement
- client interpolation
- optional immediate local animation response
- no sophisticated client prediction

This is sufficient for internal tests.

## 11.2 Later Improvement

If local movement feels delayed:

1. add client-side prediction for the local player
2. attach sequence numbers to inputs
3. receive authoritative position
4. reconcile unacknowledged inputs
5. smooth small corrections
6. snap only large invalid states

Do not implement prediction before basic multiplayer correctness.

## 11.3 Region Strategy

Start with one server region close to the expected first testers.

The user’s likely early audience should determine the first region.

Do not deploy multiple regions initially because:

- matchmaking fragments
- persistence becomes more complex
- operations cost increases
- room placement becomes harder

Measure latency before adding regions.

---

# 12. Collision Strategy

## 12.1 Initial Geometry

Use simple geometry:

- circles for players
- circles or rectangles for enemies
- circles for projectiles
- axis-aligned rectangles or simple polygons for walls

Avoid pixel-perfect collision.

## 12.2 Server Collision

Server collision determines:

- movement blocking
- projectile hits
- melee overlap
- enemy attacks
- extraction area presence
- loot pickup range

The client may predict visuals but not outcomes.

## 12.3 Spatial Index

For the first small map and 8 players:

- simple spatial grid or quadtree
- do not compare every object against every other object

Add benchmarking before selecting a more complex library.

---

# 13. Combat Implementation

## 13.1 Shared Attack Pipeline

Every attack should pass through a reusable pipeline:

```text
validate actor
  -> check cooldown
  -> build attack definition
  -> apply equipped skills
  -> apply carried-loot modifiers
  -> enforce hard caps
  -> create melee shape or projectiles
  -> resolve hits
  -> apply damage/status
  -> emit visual event
```

## 13.2 Melee

Authoritative melee data:

- origin
- facing
- range
- arc
- wind-up
- active duration
- recovery
- damage
- stun
- knockback
- hit targets

## 13.3 Ranged

Authoritative projectile data:

- owner
- position
- velocity
- lifespan
- damage
- bounce count
- pierce count
- return state
- homing strength
- targets already hit

## 13.4 Hard Caps

Initial hard caps should exist in code and tests.

Examples:

- no more than 8 primary projectiles per attack
- no more than 3 bounces
- no more than 3 pierces
- no projectile may return more than once
- split projectiles cannot split again
- child projectiles cannot create parent effects recursively
- active projectile count per player is capped
- target searches use a bounded radius

Exact values may change, but uncapped combinations are forbidden.

---

# 14. Inventory and Secure Slot

## 14.1 Server-Owned Inventory

The room stores each player’s:

- six normal inventory slots
- one secure slot
- equipped weapon
- equipped armor
- three prepared skills
- temporary wildcard skill
- derived five-category totals

## 14.2 Inventory Command

A client sends a request such as:

```ts
{
  type: "secure_item",
  sourceSlot: 2
}
```

The server checks:

- player is alive
- source slot contains an item
- secure slot is empty
- item is eligible
- player is not already processing another inventory action

The server then:

- moves the item
- removes its active build effects
- recomputes derived stats
- synchronizes the new state

## 14.3 Secure-Slot Persistence

A secure slot must be genuinely reliable.

Normal inventory remains memory-only during the match.

When an eligible item is moved into the secure slot:

1. the server validates the action
2. the server creates an idempotent secure reservation in PostgreSQL
3. the database stores match ID, user ID, item ID, and reservation status
4. only after the write succeeds does the server confirm the secure action to the client
5. the item stops providing active build power

On death or extraction:

- the reserved item converts into points or an unlock
- settlement marks the reservation consumed
- duplicate settlement cannot award it twice

If the game server crashes:

- the pending reservation remains in PostgreSQL
- the next login or recovery job finalizes the protected reward

This creates approximately one additional database write per secure action, which is acceptable because each player has only one secure slot.

A secure-slot action must never be shown as successful before its persistence write succeeds.
---

# 15. Extraction

## 15.1 Server State

Each extraction point has:

- ID
- position
- active/inactive status
- activation timestamp
- expiration timestamp
- radius
- channel duration
- players currently channeling

## 15.2 Extraction Validation

The server verifies:

- player is alive
- player is inside the zone
- player has not taken interrupting damage
- point is still active
- required channel time completed

## 15.3 Settlement Sequence

On extraction:

1. lock the player outcome
2. stop accepting gameplay inputs
3. calculate normal inventory conversion
4. calculate secure-slot conversion
5. calculate unlock items
6. build immutable reward payload
7. write reward through one atomic database operation
8. mark reward as settled
9. remove player from live match state
10. send extraction result
11. allow lobby return

If the database call temporarily fails:

- retry with the same idempotency key
- never calculate a second independent reward
- preserve the settled payload server-side until success or room shutdown policy

---

# 16. Death

On death:

1. mark the player dead
2. stop movement and attack processing
3. create a loot container from normal inventory
4. preserve secure-slot item for settlement
5. calculate secured progress
6. settle death result idempotently
7. send result to client
8. remove or spectate player
9. allow lobby return

Normal loot stays in the room for a configured duration.

There is no first-version revive.

---

# 17. Account and Authentication Flow

## 17.1 Instant Guest Play

Recommended first-visit flow:

1. create an anonymous Supabase user
2. store the session in browser storage
3. permit immediate play
4. assign a generated display name
5. after the player earns meaningful progress, encourage account linking

## 17.2 Account Linking

Allow the anonymous account to link to:

- email magic link
- Google
- Discord, if desired later

Do not require registration before the first match.

## 17.3 Anonymous Account Warning

An anonymous account cannot be recovered after:

- clearing browser storage
- using another device
- signing out without linking

The UI should explain this clearly after the player gains progression.

## 17.4 Abuse Protection

Anonymous sign-in can be abused.

Use:

- CAPTCHA where recommended
- sign-in rate limits
- server-side room admission limits
- IP and account throttles
- display-name filtering
- account age or match-count restrictions for later social features

---

# 18. Database Design

## 18.1 Tables

### `profiles`

```text
user_id UUID PRIMARY KEY
display_name TEXT
created_at TIMESTAMPTZ
last_seen_at TIMESTAMPTZ
status TEXT
```

### `point_balances`

```text
user_id UUID PRIMARY KEY
force BIGINT
precision BIGINT
motion BIGINT
guard BIGINT
signal BIGINT
updated_at TIMESTAMPTZ
```

### `unlocks`

```text
user_id UUID
unlock_id TEXT
unlock_type TEXT
unlocked_at TIMESTAMPTZ
source_match_id UUID
PRIMARY KEY (user_id, unlock_id)
```

### `loadouts`

```text
user_id UUID
slot_index SMALLINT
name TEXT
weapon_id TEXT
armor_id TEXT
skill_ids JSONB
movement_id TEXT
updated_at TIMESTAMPTZ
PRIMARY KEY (user_id, slot_index)
```

### `match_results`

```text
match_id UUID
user_id UUID
outcome TEXT
started_at TIMESTAMPTZ
ended_at TIMESTAMPTZ
duration_seconds INTEGER
kills INTEGER
pve_kills INTEGER
boss_damage INTEGER
extracted BOOLEAN
reward_payload JSONB
PRIMARY KEY (match_id, user_id)
```

### `reward_ledger`

```text
match_id UUID
user_id UUID
settlement_key TEXT
reward_payload JSONB
settled_at TIMESTAMPTZ
PRIMARY KEY (match_id, user_id)
UNIQUE (settlement_key)
```

### `secure_reservations`

```text
reservation_id UUID PRIMARY KEY
match_id UUID
user_id UUID
item_id TEXT
reservation_key TEXT UNIQUE
status TEXT
reserved_at TIMESTAMPTZ
settled_at TIMESTAMPTZ NULL
reward_payload JSONB NULL
```

Allowed status values should include:

- `pending`
- `settled`
- `cancelled`

A pending reservation must be recoverable after a game-server crash.

### `account_restrictions`

```text
user_id UUID PRIMARY KEY
restriction_type TEXT
reason TEXT
expires_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

## 18.2 Atomic Reward Function

Create a PostgreSQL function such as:

```text
settle_match_reward(...)
```

It should atomically:

1. verify the settlement key is unused
2. insert reward ledger
3. add point balances
4. insert unlocks without duplication
5. insert or update match result
6. return the new balances and unlocks

The function must be idempotent.

A repeated request with the same settlement key returns the existing result instead of awarding twice.

## 18.3 Row-Level Security

Players may read:

- their own profile
- their own points
- their own unlocks
- their own loadouts
- approved public leaderboard data later

Players must not directly write:

- point balances
- unlocks
- match outcomes
- reward ledger

The server performs trusted writes using protected credentials.

Service-role credentials must never be included in the browser bundle.

---

# 19. Progression Validation

When a player selects a pre-run loadout:

1. client sends requested IDs
2. server loads or receives verified account unlock data
3. server checks each requested weapon, armor, and skill
4. server rejects locked or incompatible combinations
5. server normalizes the loadout
6. server creates the starting equipment

The client lobby may provide convenience validation, but the server performs final validation.

---

# 20. Deployment Topology

## 20.1 Recommended Public-Test Topology

```text
Cloudflare Pages
  game.example.com
  - Vite static build
  - Phaser assets
  - HTTPS

Railway Hobby
  server.example.com
  - Node.js
  - Colyseus
  - HTTPS/WSS
  - health checks
  - one persistent replica
  - Serverless disabled

Supabase
  - Auth
  - PostgreSQL
  - migrations
  - reward function
```

## 20.2 Environment Variables

### Client

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_GAME_SERVER_URL
VITE_BUILD_VERSION
```

The publishable key is designed for browser use when Row Level Security is correctly configured. Secret keys must never be placed in `VITE_*` variables or browser bundles.

### Server

```text
NODE_ENV
PORT
SUPABASE_URL
SUPABASE_SECRET_KEY
ALLOWED_ORIGINS
GAME_BUILD_VERSION
LOG_LEVEL
SENTRY_DSN
```

Add other values only when required.

## 20.3 CORS and Origin Policy

In production, allow browser requests from:

- the official game domain
- explicitly approved preview domains

Do not use unrestricted wildcard origins for authenticated production endpoints.

## 20.4 Secure WebSockets

The public browser page uses HTTPS.

The multiplayer connection must use WSS.

Hosting platforms terminate TLS and forward traffic to the service.

---

# 21. Deployment Environments

Use separate environments.

## 21.1 Local

Purpose:

- individual development
- automated tests
- local two-client tests
- bot simulation

## 21.2 Preview or Development

Purpose:

- branch previews
- internal testing
- unstable builds
- temporary database project or isolated schema

## 21.3 Staging

Purpose:

- production-like tests
- migrations
- load tests
- deployment rehearsal
- invited testers

## 21.4 Production

Purpose:

- public users
- stable database
- controlled deployments
- monitoring
- backups

The first project may combine preview and staging, but production data must remain separate.

---

# 22. Deployment Procedure

## 22.1 Client Deployment

1. push approved code to the deployment branch
2. GitHub Actions runs:
   - install
   - lint
   - type check
   - unit tests
   - production build
3. Cloudflare Pages builds or receives the static output
4. preview URL is generated
5. production branch publishes to the main URL

## 22.2 Server Deployment

1. push approved code
2. GitHub Actions validates server tests
3. Railway pulls the repository
4. Railway installs dependencies and builds TypeScript
5. Railway starts the persistent service
6. health check verifies readiness
7. production traffic reaches the new deployment

Required Railway settings:

- one replica
- Serverless disabled
- fixed deployment region
- explicit CPU and memory limits
- restart policy enabled
- public HTTPS domain
- health-check endpoint
- production environment variables stored as provider secrets

For early versions, active matches may be interrupted during deployment.

Later, add:

- graceful room shutdown
- deployment windows
- maintenance notification
- version gating
- draining of existing rooms
## 22.3 Database Migration

1. migrations are reviewed
2. staging applies migrations
3. integration tests run
4. production migration is applied
5. server deployment follows

Never let an AI agent modify the production database interactively without reviewed migration files.

---

# 23. Cost Plan

Provider pricing changes. Verify before purchase.

## 23.1 Private Development and Initial Trial

| Service | Tier | Expected cost | Limitation |
|---|---|---:|---|
| Cloudflare Pages | Free | USD 0 | Static hosting limits apply |
| Railway | Trial or Free | USD 0 to USD 1 in the post-trial free model | Limited resources and deployment restrictions |
| Supabase | Free | USD 0 | Project pauses after one week of inactivity |
| GitHub | Free | USD 0 | CI quotas apply |
| Custom domain | None | USD 0 | Use provider subdomains |

Use this only for:

- personal testing
- demonstrations
- a few invited testers

## 23.2 Recommended Small Public Test

| Service | Tier | Expected cost |
|---|---|---:|
| Cloudflare Pages | Free | USD 0 |
| Railway game server | Hobby | USD 5 minimum; approximately USD 5 to USD 15 expected for a small capped alpha |
| Supabase | Free | USD 0 |
| GitHub | Free or existing plan | USD 0 incremental |
| Domain | Optional | Separate |

The Railway estimate depends on actual CPU, memory, and network use. Configure resource limits and billing alerts before inviting players.

**Expected starting total:** approximately USD 5 to USD 15 per month plus an optional domain.

## 23.3 Fixed-Price Fallback

Render Starter is approximately USD 10 per month, with a fixed 256 MB memory allocation and connection limit. It is simple and predictable, but the memory allowance is tighter than Railway for this game.

## 23.4 More Reliable Early Production

Possible later configuration:

| Service | Tier | Expected cost |
|---|---|---:|
| Cloudflare Pages | Free | USD 0 initially |
| Railway | Hobby or Pro, based on measured load | USD 5 to USD 20 minimum plus usage |
| Supabase | Pro | approximately USD 25/month |
| Domain | Optional | Separate |

Upgrade Supabase when public reliability, backups, log retention, or quotas justify it.

## 23.5 Main Future Cost Drivers

Monitor:

- game-server CPU
- game-server memory
- public network egress
- number of concurrent rooms
- database size
- database egress
- authentication users
- logs and telemetry
- multi-region deployment

Concurrent players and simulation complexity matter more than registered account count.
# 24. Hosting Alternatives

## 24.1 Render

Advantages:

- fixed monthly instance price
- easy Git deployment
- WebSocket support
- automatic TLS
- predictable billing

Disadvantages:

- the current Starter instance has only 256 MB RAM
- the next meaningful memory tier costs substantially more
- less flexible region and resource selection than Railway for this prototype

Use Render when a fixed bill is more important than flexible resource headroom.
## 24.2 Colyseus Cloud

Advantages:

- built specifically for Colyseus
- managed multiplayer deployment
- easier scaling path
- less infrastructure work

Disadvantages:

- additional managed-service dependency
- price should be reviewed at decision time
- unnecessary for an 8-player prototype

Consider it after the game proves demand.

## 24.3 Cloudflare Durable Objects or PartyKit

Advantages:

- global edge platform
- stateful WebSocket rooms
- potentially elegant room-per-object design
- strong scaling primitives

Disadvantages:

- more custom game-networking work
- high-frequency authoritative action simulation may not benefit from hibernation
- cost behavior depends heavily on active duration and message rate
- resource and runtime constraints differ from normal Node hosting
- Codex or Claude Code must build more infrastructure rather than relying on Colyseus behavior

This is technically viable but not the recommended first implementation.

## 24.4 One Render Project for Everything

Possible:

- Render static site
- Render game server
- Render PostgreSQL

Advantages:

- one provider
- simpler billing

Disadvantages:

- less attractive free database lifecycle
- higher small-project cost
- Supabase provides easier guest auth and progression tooling

Not recommended unless provider consolidation is more important than cost.

## 24.5 Unity WebGL

Advantages:

- mature visual editor
- broad game ecosystem
- strong asset workflow

Disadvantages:

- larger downloads
- slower browser startup
- more difficult automated text-based modification
- more build complexity
- multiplayer server still required
- less suitable for a lightweight Codex/Claude-driven web project

Not recommended for this project.

---

# 25. Why Not Peer-to-Peer

Do not make one player host the match.

Peer hosting creates:

- host cheating
- host migration problems
- NAT and connectivity issues
- unstable latency
- match loss when host leaves
- exposed network information
- inconsistent authority

A small dedicated authoritative server is worth the modest monthly cost.

---

# 26. Codex Development Method

## 26.1 Repository Instructions

Create an `AGENTS.md` in the repository root.

It should define:

- design documents that are authoritative
- repository structure
- commands
- test requirements
- architectural boundaries
- security rules
- forbidden changes
- completion checklist

Codex reads scoped `AGENTS.md` files before working.

Use additional scoped files only if a package requires special rules.

## 26.2 Suggested `AGENTS.md` Sections

```markdown
# Project Rules

## Authoritative Documents
- docs/GAME_CONCEPT.md
- docs/TECHNICAL_PLAN.md
- docs/PROTOCOL.md

## Required Commands
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm test:e2e

## Architecture
- Client sends intent only.
- Server owns match outcomes.
- Supabase stores permanent progression.
- No in-run leveling.
- No persistent ordinary item stash.

## Safety
- Never expose service-role credentials.
- Never trust client reward data.
- Preserve hard projectile caps.
- Use migrations for database changes.

## Scope
- Do not add unrequested systems.
- Do not rewrite unrelated modules.
- Keep content data-driven.

## Completion
- Add tests.
- Update docs.
- Run required commands.
- Report limitations.
```

## 26.3 Execution Plans

For large milestones, require a written execution plan before code changes.

Examples:

- multiplayer room architecture
- authentication
- reward settlement
- deployment
- client prediction

The plan should include:

- files to change
- invariants
- tests
- migration impact
- rollback
- acceptance criteria

## 26.4 Codex Permissions

Codex commonly runs in a sandbox.

Package installation, network access, and deployment may require explicit permission.

Do not grant broad production credentials.

Provide:

- local test credentials
- staging secrets through provider settings
- narrowly scoped deployment access
- no service-role key in prompts or committed files

---

# 27. Claude Code Development Method

## 27.1 Repository Instructions

Create `CLAUDE.md`.

It should mirror the same architectural rules as `AGENTS.md`.

Avoid maintaining contradictory instructions.

A practical approach:

- place detailed shared rules in `docs/DEVELOPMENT_RULES.md`
- make both `AGENTS.md` and `CLAUDE.md` reference it
- keep tool-specific instructions small

## 27.2 Subagents

Claude Code subagents may be useful for:

- test review
- security review
- protocol review
- content validation
- documentation updates

Do not let several agents modify the same subsystem simultaneously without isolated branches or worktrees.

## 27.3 Skills and Commands

Create repeatable project skills or command templates for:

- implement one milestone
- review authoritative-server boundaries
- add one data-driven skill
- run multiplayer tests
- prepare deployment
- audit migrations

---

# 28. Agent Task Format

Give Codex or Claude Code bounded tasks.

Bad task:

> Build the multiplayer extraction game.

Good task:

```text
Implement Milestone M2.3: server-authoritative player movement.

Context:
- Read docs/GAME_CONCEPT.md and docs/TECHNICAL_PLAN.md.
- One Colyseus room represents one match.
- The server runs a fixed 20 Hz simulation.

Requirements:
1. Accept normalized movement input and aim angle.
2. Validate input ranges and input rate.
3. Move players only on the server.
4. Prevent movement through rectangular walls.
5. Synchronize position and facing.
6. Add unit tests for valid movement, overspeed attempts,
   malformed messages, and wall collision.

Non-goals:
- attacks
- enemies
- client prediction
- account persistence

Acceptance:
- pnpm lint
- pnpm typecheck
- pnpm test
- two browser clients can join and see movement
- no client can directly set position
```

This format is essential.

Coding agents are capable. They are not clairvoyant senior producers who infer ten months of design from “make it fun.”

---

# 29. Git and Branch Strategy

Recommended:

- protected `main`
- short-lived feature branches
- one milestone per pull request
- required CI checks
- reviewed migrations
- no direct production edits
- tagged playable builds

Suggested tags:

```text
v0.1.0-local-combat
v0.2.0-local-extraction
v0.3.0-networked-room
v0.4.0-auth-progression
v0.5.0-private-test
v0.6.0-public-alpha
```

---

# 30. Testing Strategy

## 30.1 Unit Tests

Use Vitest for:

- stat derivation
- skill compatibility
- effect caps
- inventory movement
- secure slot
- point conversion
- extraction calculation
- reward payload generation
- duplicate unlock conversion
- cooldown validation

Run TypeScript type checking separately because test transformation alone is not type checking.

## 30.2 Room Integration Tests

Use Colyseus testing tools to:

- create a room
- join multiple simulated clients
- send messages
- verify synchronized state
- test disconnects
- test room disposal
- test extraction
- test death and dropped loot

## 30.3 Browser Tests

Use Playwright for:

- landing page
- anonymous sign-in
- loadout selection
- joining a room
- reconnect screen
- extraction result
- account-link warning
- supported browser smoke tests

Do not use Playwright to verify every combat frame.

## 30.4 Load Tests

Build bot clients that can:

- join rooms
- move
- attack
- collect loot
- die
- extract
- disconnect
- reconnect

Test progressively:

```text
1 room x 8 clients
5 rooms x 8 clients
10 rooms x 8 clients
target concurrency for current server tier
```

Measure:

- CPU
- memory
- event-loop lag
- outbound bandwidth
- state-patch size
- room tick duration
- database settlement latency
- error rate

Never accept generic connection-capacity claims as proof for this game. Actual projectiles, enemies, and patches determine capacity.

## 30.5 Soak Tests

Run long tests to detect:

- memory leaks
- rooms that fail to dispose
- disconnected clients retained in memory
- growing projectile collections
- reward retries
- log volume problems

---

# 31. Continuous Integration

Each pull request should run:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Selected branches or scheduled jobs should also run:

```text
pnpm test:integration
pnpm test:e2e
pnpm test:load:smoke
```

Use dependency and code scanning available through GitHub.

Do not automatically deploy a branch that failed tests.

---

# 32. Observability

## 32.1 Structured Logs

Use structured JSON logs.

Include:

- timestamp
- severity
- build version
- server instance
- room ID
- match ID
- anonymous internal player ID
- event name
- duration
- error code

Do not log:

- access tokens
- service keys
- raw private account data
- full IP addresses unless required and legally justified
- sensitive authentication payloads

## 32.2 Metrics

Track:

- connected clients
- active rooms
- average room tick duration
- maximum room tick duration
- event-loop lag
- messages per second
- bytes per client
- match duration
- extraction rate
- death rate
- reward settlement failures
- disconnect rate
- reconnect rate
- server memory
- server CPU

## 32.3 Error Monitoring

Use a service such as Sentry only when needed.

Initially, provider logs plus structured application logs may be sufficient.

---

# 33. Basic Anti-Cheat

The authoritative server removes the easiest cheats, but not all abuse.

Validate:

- input rate
- movement magnitude
- attack cooldown
- dash cooldown
- interaction distance
- inventory ownership
- item state
- extraction presence
- loadout unlocks
- message schema
- room membership
- party membership

Add:

- per-message rate limits
- maximum packet sizes
- invalid-message counters
- temporary disconnect after repeated invalid behavior
- server-generated IDs
- idempotent rewards

Do not attempt kernel-level anti-cheat for a browser game. That would be both absurd and ineffective.

---

# 34. Reconnection

## 34.1 Initial Policy

Recommended first version:

- short reconnect window
- disconnected player remains in the room
- player becomes stationary and vulnerable
- reconnect restores control
- failure to reconnect results in death or abandonment

Do not make disconnected players invulnerable.

## 34.2 Authentication

Reconnect requires:

- valid account token
- room reservation or reconnect token
- matching player identity
- unexpired window

---

# 35. Version Compatibility

The client and server should exchange:

- protocol version
- content version
- build version

If incompatible:

- prevent match joining
- show refresh/update message

This prevents an old browser tab from sending messages the new server no longer understands.

---

# 36. Asset Delivery

## 36.1 Initial Asset Strategy

Use:

- sprite atlases
- compressed PNG or WebP where appropriate
- compressed audio
- lazy loading for nonessential assets
- cache-busting filenames
- small initial download

## 36.2 Initial Target

Keep first-load size modest.

Do not ship:

- unused art
- uncompressed source files
- development maps
- raw audio
- duplicate sprites

Cloudflare Pages or its CDN serves versioned static assets.

---

# 37. Browser Support

Initial support target:

- current stable Chrome
- current stable Edge
- current stable Firefox
- current Safari desktop version after testing

Desktop first.

Mobile-browser support requires:

- touch controls
- responsive HUD
- performance testing
- device-memory constraints
- background-tab behavior
- network transitions

Do not claim mobile support until it is tested.

---

# 38. Development Milestones

## M0: Repository Foundation

Deliver:

- monorepo
- Phaser client
- Colyseus server
- shared packages
- strict TypeScript
- linting
- unit tests
- CI
- `AGENTS.md`
- `CLAUDE.md`
- design documents

Exit criteria:

- client builds
- server starts
- CI passes
- client can reach health endpoint

## M1: Local Single-Player Combat

Deliver:

- movement
- aim
- sword
- bow
- one enemy
- health
- death
- basic map collision

Exit criteria:

- combat is playable locally
- tests cover combat math
- no network required

## M2: Loot and Extraction

Deliver:

- loot drops
- six-slot inventory
- five point categories
- secure slot
- rotating extraction
- local run result

Exit criteria:

- loot changes build
- securing removes active effect
- death and extraction differ correctly

## M3: Data-Driven Skills

Deliver:

- three pre-run skill slots
- 8 to 10 initial skills
- shared effect pipeline
- wildcard skill
- hard caps

Exit criteria:

- supported combinations work
- invalid combinations are rejected
- no recursive effect explosion

## M4: Authoritative Multiplayer

Deliver:

- one Colyseus room
- two to eight clients
- authoritative movement
- authoritative combat
- synchronized enemies
- dropped loot
- extraction

Exit criteria:

- two real browsers can play
- client cannot set position or rewards
- room integration tests pass

## M5: Accounts and Progression

Deliver:

- anonymous auth
- profiles
- point balances
- unlocks
- loadouts
- atomic reward settlement
- account linking warning

Exit criteria:

- extracted points persist
- secure-slot progress persists after death
- duplicate settlement does not duplicate rewards

## M6: Party and Matchmaking

Deliver:

- create party
- join code
- party of three
- match queue
- shared party markers

Exit criteria:

- party joins one room together
- individual inventories remain separate

## M7: Boss and Rare Skill

Deliver:

- one boss
- boss core
- temporary use
- secure permanent unlock
- duplicate conversion

Exit criteria:

- all three boss-core decisions work
- settlement remains idempotent

## M8: Private Internet Test

Deliver:

- Cloudflare Pages deployment
- Render deployment
- Supabase production project
- monitoring
- version checks
- invited testers

Exit criteria:

- external users can open one URL and play
- server remains stable under target test
- reward data survives deployment

## M9: Public Alpha

Deliver:

- basic moderation
- reconnect
- load test
- performance pass
- clear support messaging
- backup and rollback procedure

Exit criteria:

- measured capacity is known
- public player cap is enforced
- critical failures have operational procedures

---

# 39. Recommended First Deployment

For the first external test:

```text
Client:
  Cloudflare Pages free tier

Server:
  Render Starter
  0.5 CPU / 512 MB class
  one region
  one Node process

Database:
  Supabase Free

Match:
  maximum 8 players
  maximum room count based on measured load
  fixed match start
  no late join
```

Do not expose unlimited room creation.

Set a global concurrency cap appropriate to the measured server.

When full:

- show queue or server-full message
- do not silently overload the process

---

# 40. Scaling Plan

## 40.1 Scale Up First

Before adding distributed architecture:

1. optimize simulation
2. reduce state size
3. add spatial interest filtering
4. measure room cost
5. move to a larger single instance

This is simpler than immediate multi-process scaling.

## 40.2 Scale Out Later

When one process is insufficient:

- run multiple game-server processes
- use shared matchmaking/presence infrastructure
- route parties to the same process
- keep each room owned by exactly one process
- use Redis or the official Colyseus scaling approach where required

Do not distribute one room across several servers.

## 40.3 Multi-Region Later

Add regions only after:

- stable demand
- measured latency
- enough players per region
- region-selection UX
- matchmaking design

---

# 41. Failure and Recovery

## 41.1 Game-Server Crash

MVP behavior:

- active match is lost
- uncommitted normal loot is lost
- uncommitted secure-slot loot may be lost
- players reconnect to lobby
- incident is logged

Later:

- checkpoint rare secured unlocks
- maintain room recovery metadata
- improve graceful restart

Do not claim crash-proof progression until implemented.

## 41.2 Database Outage

- stop new reward settlements
- retain idempotent payloads temporarily
- retry
- do not invent success
- communicate delayed result
- prevent duplicate credit

## 41.3 Deployment Failure

- keep previous client build available
- roll back server image
- roll back migrations only through reviewed migration strategy
- never manually edit production rows as a normal fix

---

# 42. Security Checklist

Before public alpha:

- HTTPS and WSS only
- service key stored only on server
- anonymous auth abuse protection
- server-side loadout validation
- server-side reward calculation
- idempotent reward settlement
- strict message schemas
- message-rate limits
- origin allowlist
- secure headers
- dependency alerts
- no secrets in repository
- production and staging separation
- database row-level security
- logs scrubbed of tokens
- account deletion path planned
- privacy notice prepared

---

# 43. Content Workflow for Coding Agents

Adding a normal skill should follow:

1. define skill in data
2. validate tags
3. connect to existing effect primitive
4. add icon reference
5. add balance tests
6. add combination-limit tests
7. update content documentation
8. run all tests

Adding a completely new primitive requires:

1. design approval
2. server implementation
3. client visualization
4. protocol review
5. anti-recursion review
6. performance test
7. automated tests

This distinction prevents every new skill from becoming a custom subsystem.

---

# 44. Recommended Technical Decisions

## Approved Baseline

- Phaser 4
- TypeScript
- Vite
- Node.js 24 LTS
- Colyseus
- Supabase
- Cloudflare Pages
- Render Starter
- GitHub Actions
- Vitest
- Playwright
- server-authoritative simulation
- one match per room
- one region initially
- 8-player initial room
- 20 Hz initial server tick
- anonymous-first authentication
- atomic reward settlement
- no persistent match state in the database
- no direct client reward writes
- desktop browser first
- no peer hosting
- no Unity WebGL
- no microservice architecture

## Deferred

- client prediction
- mobile controls
- multi-region
- multi-process Colyseus
- Redis
- paid Supabase
- managed Colyseus Cloud
- advanced anti-cheat
- replay system
- spectator mode
- live operations dashboard

---

# 45. What Codex or Claude Code Can Realistically Do

They can effectively assist with:

- scaffolding the monorepo
- creating Phaser scenes
- implementing reusable systems
- generating TypeScript definitions
- building Colyseus rooms
- writing database migrations
- adding tests
- debugging failures
- creating deployment configuration
- documenting protocols
- reviewing diffs
- refactoring bounded modules
- running local test commands
- preparing GitHub Actions
- generating bot clients
- deploying through supported workflows when credentials and permission are supplied

They should not be trusted to autonomously decide:

- production architecture changes
- monetization
- final balance
- security exceptions
- production migrations
- secret handling
- unbounded feature scope
- whether a test result is “good enough”
- whether generated combat is actually fun

Human playtesting remains mandatory. A test suite can confirm that a hammer deals 20 damage. It cannot confirm that being hit by it feels satisfying rather than vaguely administrative.

---

# 46. Immediate Next Technical Deliverables

Before writing major gameplay code, create:

1. `docs/PROTOCOL.md`
2. `docs/DATA_MODEL.md`
3. `docs/CONTENT_AUTHORING.md`
4. `docs/TEST_PLAN.md`
5. root `AGENTS.md`
6. root `CLAUDE.md`
7. monorepo scaffold
8. local client/server hello-world connection
9. CI pipeline
10. first milestone issue list

After those exist, begin M1 local combat.

---

# 47. Final Recommendation

Build the first complete vertical slice using:

- Phaser 4.2.x and TypeScript in the browser
- Colyseus 0.17.x and Node.js 24 LTS on one authoritative server
- Supabase for anonymous accounts and permanent progression
- Cloudflare Pages for free client hosting
- Railway Hobby for one persistent WebSocket game-server replica

Players will access one normal HTTPS URL and play without installation.

Begin with 8-player rooms and one region. Keep the server authoritative. Store permanent outcomes and secure-slot reservations in PostgreSQL. Use free tiers for the client and database, and expect approximately USD 5 to USD 15 per month for the capped Railway game server once external players are invited.

This provides the best balance of:

- implementation simplicity
- coding-agent compatibility
- low initial cost
- browser accessibility
- multiplayer correctness
- room to scale after the game proves itself

---

# 48. Official Documentation Reviewed

The technical conclusions in this document were checked against current official documentation available on 2026-07-29, including:

- OpenAI Codex documentation and engineering guidance
- Anthropic Claude Code documentation
- Phaser official documentation
- Node.js release documentation
- Colyseus documentation
- Supabase Auth, database, and pricing documentation
- Cloudflare Pages and Durable Objects documentation
- Render WebSocket, deployment, and pricing documentation
- Railway deployment and pricing documentation
- Vite deployment documentation
- Vitest documentation
- Playwright documentation
- GitHub Actions and security documentation

Provider pricing and quotas may change. Verify them immediately before committing payment or publishing a production launch.
