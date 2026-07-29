# Lightweight Multiplayer Extraction Roguelite
## Core Game Concept and Design Specification

**Document status:** Concept baseline  
**Audience:** Codex, Claude Code, developers, designers, and future implementation agents  
**Purpose:** Define the game clearly enough that implementation can proceed in controlled milestones without reinterpreting the core rules  
**Technical architecture:** Intentionally deferred to a separate document  
**Working title:** TBD  

---

# 1. Executive Summary

This game is a lightweight, browser-accessible, top-down multiplayer extraction roguelite.

Players enter a shared map either alone or in a small party. They fight simple PvE enemies, encounter other players, collect loot, improve their current combat build through carried items, and attempt to leave through extraction points that appear and disappear at changing locations.

The game combines:

- PvE combat
- Optional PvP
- Solo play
- Small-group play
- Loot collection
- Build customization
- Extraction risk
- Permanent account progression
- Short, repeatable sessions

The game must remain simple enough to build and maintain with heavy assistance from Codex or Claude Code. It must avoid MMO-scale systems, complex 3D graphics, large content pipelines, and inventory-management burden.

The central design rule is:

> **Everything carried in normal inventory can make the player stronger, but is lost on death. Items moved into a secure slot no longer provide active power, but survive death and convert into permanent progress.**

A second major rule is:

> **Permanent progression unlocks choices and build variety, not overwhelming permanent power.**

The player account stores:

- unlocked starting weapons
- unlocked armor types
- unlocked skills
- permanent progression points
- loadout presets
- cosmetics
- limited mastery upgrades

The account does not store hundreds of individual weapons, armor pieces, or random-stat equipment.

---

# 2. Design Goals

## 2.1 Primary Goals

The game should:

1. Be easy to start in a browser.
2. Support both solo players and small parties.
3. Mix PvE and PvP naturally on the same map.
4. Create meaningful risk through extraction.
5. Let players create skill combinations before entering a run.
6. Let collected loot change the current play style during a run.
7. Make death meaningful without making the account unusable.
8. Avoid complicated persistent inventory management.
9. Use simple visuals that remain readable during multiplayer combat.
10. Be feasible for a small development effort using Codex or Claude Code.

## 2.2 Player Experience Goal

A player should be able to:

1. Open the game.
2. Select a simple loadout.
3. Enter a match quickly.
4. Fight enemies and collect loot.
5. Adapt their build based on carried loot.
6. Encounter other players and decide whether to avoid, fight, or cooperate.
7. Choose between safety and greed.
8. Attempt extraction.
9. Gain permanent unlock progress.
10. Start another run without managing a large stash.

## 2.3 Session Goal

A normal session should feel complete within approximately:

- **5 to 12 minutes** for early versions
- potentially **10 to 15 minutes** after balance and map expansion

The game should support short sessions without preventing longer high-risk runs.

---

# 3. Non-Goals

The following are explicitly outside the initial design:

- seamless MMO world
- hundreds of players in one room
- complex quests
- narrative campaign
- large open-world simulation
- player housing
- guild systems
- player economy
- auction house
- crafting trees
- persistent item stash
- procedural item affixes
- durability and repair
- item insurance
- complex armor slots
- first-person or third-person 3D combat
- advanced physics
- large-scale destructible environments
- in-run character leveling
- Archero-style random level-up selection
- battle royale shrinking circles
- mandatory PvP
- mandatory group play
- permanent stat advantages that make new players irrelevant

These systems may be reconsidered much later, but they must not shape the initial architecture unless separately approved.

---

# 4. Core Game Loop

## 4.1 Pre-Run

Before entering a match, the player selects:

- one starting weapon
- one starting armor type
- up to three equipped permanent skills
- one basic movement ability
- optional loadout preset

The player does not bring persistent individual equipment into the match.

Unlocked starting equipment is generated as a basic version for each new run.

## 4.2 During the Run

The player:

1. enters the shared map
2. fights PvE enemies
3. collects loot items
4. changes current combat behavior through loot composition
5. finds temporary equipment or a temporary wildcard skill
6. encounters other players
7. chooses whether to continue farming or attempt extraction
8. places especially valuable loot into the secure slot when desired
9. travels to a temporary extraction point
10. either extracts successfully or dies

## 4.3 On Successful Extraction

When the player extracts:

- normal inventory loot converts into five permanent point categories
- secure-slot loot also converts or unlocks its special content
- rare blueprints may permanently unlock weapons or armor
- boss skill cores may permanently unlock skills
- duplicate unlock items convert into permanent points
- temporary run equipment is removed
- temporary wildcard skills are removed
- match results are recorded

## 4.4 On Death

When the player dies:

- all normal inventory loot drops on the ground
- equipped temporary equipment may drop, depending on balance
- the temporary wildcard skill is lost
- other players may loot the body
- secure-slot contents do not drop
- secure-slot contents automatically convert into permanent progress or unlocks
- the run ends
- the player returns to the lobby and may immediately start another run

There is no same-match respawn in the initial version.

---

# 5. Permanent Progression Model

## 5.1 Progression Philosophy

Permanent progression should unlock variety, not create impossible power gaps.

Long-term players should have:

- more weapon choices
- more armor choices
- more skills
- more build combinations
- more loadout presets
- modest mastery improvements
- cosmetic status

They should not receive:

- many additional skill slots
- extreme base health
- overwhelming base damage
- large extraction advantages
- equipment that new players cannot realistically fight

## 5.2 Permanent Account Data

The account stores:

- progression point balances
- weapon blueprints
- armor blueprints
- skill unlocks
- boss skill unlocks
- mastery levels
- cosmetics
- statistics
- achievements
- loadout presets

The account does not store ordinary looted items as individual objects.

## 5.3 Starting Equipment Blueprint Rule

Unlocking a weapon or armor type gives the player permanent permission to select a basic version before every run.

Example:

- The account unlocks **Spear Blueprint**.
- The player may now choose Basic Spear as a starting weapon.
- The spear is created for free when the run starts.
- Dying does not remove the blueprint.
- A stronger temporary spear found during a run is still lost when the run ends unless converted into progression through extraction.

## 5.4 Default Loadout

Every new account should have a viable default set.

Suggested initial defaults:

### Weapons
- Basic Sword
- Basic Bow

### Armor
- Medium Armor

### Skills
- Extended Melee Range
- Projectile Speed
- Attack Speed
- Small Defensive Shield
- Dash Recovery
- Minor Loot Detection

The default options must remain balanced and useful. Unlocks should expand possibilities rather than make default equipment obsolete.

---

# 6. Progression Point System

Each ordinary loot item contributes values to five permanent point categories.

Suggested categories:

1. **Force**
2. **Precision**
3. **Motion**
4. **Guard**
5. **Signal**

These names are placeholders and may be renamed later.

## 6.1 Force

Represents:

- melee power
- impact
- knockback
- heavy weapons
- stun strength

Used to unlock or improve:

- swords
- spears
- hammers
- heavy melee skills
- aggressive armor effects

## 6.2 Precision

Represents:

- ranged damage
- projectile speed
- critical effects
- penetration
- accurate attacks

Used to unlock or improve:

- bows
- projectile weapons
- precision skills
- critical effects
- ranged weapon families

## 6.3 Motion

Represents:

- attack speed
- movement speed
- dash behavior
- recovery speed
- mobility-focused weapons

Used to unlock or improve:

- daggers
- rapid ranged weapons
- movement skills
- light armor
- dash modifications

## 6.4 Guard

Represents:

- health
- shields
- resistance
- defensive effects
- heavy armor

Used to unlock or improve:

- armor types
- shield skills
- defensive melee behavior
- resistance effects

## 6.5 Signal

Represents:

- homing
- ricochet
- detection
- unusual targeting
- utility mechanics
- information effects

Used to unlock or improve:

- homing projectiles
- ricochet
- loot detection
- enemy detection
- special utility skills

## 6.6 Point Conversion

Each loot item contains a fixed point distribution.

Example:

```yaml
item_name: Ancient Targeting Core
rarity: uncommon
points:
  force: 0
  precision: 2
  motion: 1
  guard: 0
  signal: 4
```

When extracted or secured, these values are added to the player's permanent point balances.

The initial game should avoid:

- item-quality randomness
- random stat rolls
- procedural affixes
- hidden conversion formulas

Every item should have clear, fixed values.

---

# 7. Inventory System

## 7.1 Normal Inventory

Suggested initial size:

- six normal inventory slots

Items in normal inventory:

- contribute to the current run build
- can be rearranged
- can be discarded
- can be replaced
- are visible in a simple UI
- drop on death
- convert into points on extraction

Normal inventory is both:

- a loot container
- a temporary build system

## 7.2 Secure Slot

Every player begins with:

- one secure inventory slot

A possible second secure slot may be a late permanent unlock, but the game should never exceed two secure slots without strong evidence.

An item placed in the secure slot:

- stops contributing to the current build
- cannot be removed during the run in the initial version
- cannot be looted by another player
- survives death
- automatically converts into permanent progress after death or extraction

This creates the central decision:

> Keep the item active for power, or secure it for guaranteed progress.

## 7.3 Secure Slot Restrictions

The secure slot should accept:

- ordinary point items
- weapon blueprints
- armor blueprints
- boss skill cores
- rare unlock items

It should not accept:

- equipped starting weapon
- equipped starting armor
- ordinary consumable effects
- temporary wildcard skill after activation

## 7.4 No Persistent Stash

Ordinary extracted items must convert automatically.

The player should not return to a lobby containing individual loot objects.

This avoids:

- stash sorting
- stash size
- inventory clutter
- insurance
- repair
- item deletion
- item selling
- duplicate equipment management

---

# 8. Starting Loadout

## 8.1 Weapon Slot

Each player chooses one starting weapon.

Suggested initial weapon families:

### Basic Sword
- balanced melee weapon
- medium attack arc
- medium attack speed
- moderate damage
- simple to understand

### Basic Spear
- long narrow melee attack
- lower attack arc
- stronger spacing control
- moderate recovery

### Basic Hammer
- slow attack
- high impact
- high stun potential
- short vulnerability after attack

### Basic Bow
- balanced ranged weapon
- moderate projectile speed
- moderate attack rate

Additional weapon families may be added after the core systems work.

## 8.2 Armor Slot

Each player chooses one armor type.

Suggested initial armor types:

### Light Armor
- higher movement speed
- faster dash recovery
- lower damage resistance

### Medium Armor
- balanced movement and defense
- default choice

### Heavy Armor
- higher damage resistance
- slower movement
- slower dash recovery

Armor should be a single slot.

The initial game should not include separate:

- helmet
- gloves
- boots
- belt
- ring
- necklace

## 8.3 Skill Slots

Each player equips:

- three permanent skill blueprints

Rules:

- all players have the same number of permanent skill slots
- skill-slot count does not increase through progression
- strong rare skills may cost two slots
- skills are selected before entering the match
- there is no in-run level-up or random skill draft

## 8.4 Movement Ability

Every player begins with a basic dash.

Future unlocked alternatives may include:

- shorter dash with two charges
- longer dash with higher cooldown
- defensive roll
- directional blink
- shielded dash

The movement system should remain readable and limited.

---

# 9. Skill System

## 9.1 Skill Philosophy

Skills modify shared combat systems.

Most skills should be data-driven combinations of reusable effect primitives.

The game should avoid writing separate custom logic for every skill combination.

## 9.2 Core Effect Primitives

Suggested initial primitives:

- damage multiplier
- attack-speed multiplier
- range multiplier
- projectile count
- projectile spread
- projectile speed
- bounce count
- pierce count
- homing strength
- return behavior
- stun chance
- stun duration
- knockback
- critical chance
- shield generation
- status effect chance
- dash recovery
- movement speed
- detection radius

## 9.3 Skill Tags

Suggested tags:

```text
Projectile
Melee
Attack
Movement
Defense
OnHit
OnKill
Bounce
Return
Pierce
Homing
Stun
Critical
Shield
Detection
Boss
Rare
```

Skills should declare compatibility through tags.

Example:

```yaml
id: returning_projectiles
name: Returning Projectiles
slot_cost: 1
requires_tags:
  - Projectile
effects:
  return_enabled: true
  return_damage_multiplier: 0.6
limits:
  max_returns: 1
  can_trigger_return_again: false
```

## 9.4 Example Skill Combinations

### Ranged Combination

- Multishot
- Ricochet
- Returning Projectiles

Possible result:

- multiple projectiles launch
- projectiles can bounce
- surviving projectiles return once
- recursive splitting or endless return is forbidden

### Guided Ranged Combination

- Additional Projectiles
- Homing
- Pierce

Possible result:

- several projectiles seek nearby targets
- each projectile may pass through a limited number of enemies

### Melee Control Combination

- Extended Reach
- Faster Recovery
- Stun Impact

Possible result:

- longer melee attack
- shorter recovery
- moderate chance to stun

### Defensive Melee Combination

- Shield on Attack
- Knockback
- Wide Arc

Possible result:

- wide attack
- pushes enemies away
- grants a small temporary shield

## 9.5 Combination Safety Limits

Hard caps are mandatory.

Suggested caps:

- maximum projectiles per attack
- maximum bounces
- maximum pierces
- maximum child projectiles
- maximum active projectiles per player
- maximum homing search radius
- maximum status-effect stacks
- no recursive return
- no recursive split
- no effect triggering itself indefinitely
- no infinite on-hit loop

These limits must exist in shared combat code, not only in content data.

---

# 10. Temporary Wildcard Skill

Each player may have:

- one temporary wildcard skill slot

The wildcard slot begins empty.

During the run, the player may find a temporary skill chip.

Rules:

- the chip grants one temporary skill
- the skill lasts only for the current run
- only one wildcard skill can be active
- a new chip may replace the current one
- the temporary skill drops or disappears on death
- it does not become permanent unless obtained as an extractable boss skill core or approved unlock item

This provides adaptation and discovery without adding in-run leveling.

---

# 11. Boss Skill Cores

Bosses may drop rare skill cores.

A boss skill core creates a risk decision.

Possible options:

1. **Activate now**
   - grants the boss skill as the current wildcard skill
   - provides immediate combat power
   - cannot be secured after activation
   - is lost on death

2. **Carry normally**
   - may provide passive temporary power
   - remains lootable
   - can be extracted for permanent unlock

3. **Place in secure slot**
   - stops providing combat power
   - survives death
   - permanently unlocks the base boss skill after the run

Duplicate boss skill cores:

- do not create duplicate inventory objects
- convert into progression points or mastery progress

Strong boss skills may require:

- two permanent skill slots when equipped before a future run

---

# 12. Loot as Temporary Build Power

## 12.1 Core Rule

The point values of carried normal-inventory items also modify the current build.

Example inventory totals:

```yaml
force: 2
precision: 8
motion: 4
guard: 1
signal: 7
```

Possible effects:

- Precision increases ranged damage or penetration
- Motion increases attack speed or recovery
- Signal improves ricochet or homing
- Force improves impact
- Guard improves shields or resistance

## 12.2 Build Scaling Principles

The system should:

- be visible to the player
- use small, capped bonuses
- avoid exponential scaling
- reward specialization
- permit mixed builds
- never make one loot category useless

## 12.3 Recommended Scaling Model

Use threshold-based or gently diminishing returns.

Example:

```text
0–2 points: minor effect
3–5 points: noticeable effect
6–8 points: strong effect
9+ points: capped or diminishing effect
```

Exact values are deferred to balance testing.

## 12.4 Weapon Style Transformation

The dominant carried point category may change the current weapon style.

This system should use a limited number of clear transformations.

### Sword Examples

- Force dominant: slower, larger cleave
- Precision dominant: narrower critical strike
- Motion dominant: faster repeated slashes
- Guard dominant: brief defense during attack
- Signal dominant: short ranged blade wave

### Bow Examples

- Force dominant: heavy knockback projectile
- Precision dominant: piercing projectile
- Motion dominant: rapid fire
- Guard dominant: small shield after repeated hits
- Signal dominant: mild homing or bounce

The first implementation may use only numerical modifications. Full style transformations can be added after the core loop is stable.

---

# 13. Combat

## 13.1 Basic Controls

Suggested desktop controls:

- WASD: movement
- mouse: aim
- left click: basic attack
- space: dash
- E: interact or extract
- Tab or I: inventory
- number keys or simple hotkeys: optional future abilities

Mobile controls are deferred until desktop gameplay is proven.

## 13.2 Attack Types

The game begins with two fundamental attack categories:

### Melee

Core variables:

- damage
- range
- arc width
- wind-up
- active time
- recovery
- knockback
- stun chance

### Ranged

Core variables:

- damage
- projectile speed
- attack rate
- projectile count
- spread
- bounce
- pierce
- homing
- return
- explosion radius

## 13.3 Combat Readability

The game must prioritize:

- visible attack telegraphs
- simple silhouettes
- limited particles
- clear team indicators
- obvious damage sources
- clear extraction effects
- distinguishable melee and ranged attacks

The game should avoid:

- excessive screen shake
- large opaque effects
- unreadable projectile spam
- complex animation requirements
- detailed 3D models

---

# 14. PvE System

## 14.1 Purpose of PvE

PvE creates:

- loot
- risk
- map activity
- opportunities for cooperation
- opportunities for ambush
- progression toward boss encounters

PvE should not exist only as target practice.

## 14.2 Initial Enemy Types

Suggested first three enemies:

### Chaser
- moves directly toward the nearest player
- basic contact or melee damage
- low complexity

### Ranged Enemy
- maintains simple distance
- fires slow, visible projectiles
- easy to read and dodge

### Heavy Enemy
- slow
- high health
- telegraphed attack
- better loot

## 14.3 Initial Boss

The first boss should:

- have a limited move set
- be readable
- support melee and ranged interaction
- drop rare loot
- attract nearby players
- create optional PvPvE conflict

Suggested move count:

- two normal attacks
- one area attack
- one phase or behavior change

Do not build a complex raid boss for the first version.

---

# 15. PvP System

## 15.1 PvP Philosophy

PvP is allowed and meaningful, but the game is not purely PvP-focused.

Players may:

- avoid others
- fight others
- ambush weakened players
- protect another player temporarily
- fight a boss near strangers
- loot battle remains
- contest extraction points

## 15.2 Death Looting

When a player dies:

- normal inventory items drop
- secure-slot items remain protected
- dropped items are visible and lootable
- the body or loot container persists for a limited duration

Initial recommendation:

- no complex corpse AI
- no Combat Echo system in the first version
- no same-match resurrection

Those ideas may be tested later.

## 15.3 Group Size

Recommended party size:

- maximum three players

Reasons:

- supports meaningful cooperation
- limits group dominance
- reduces synchronization complexity
- remains understandable for solo players

---

# 16. Solo and Group Balance

## 16.1 Solo Strengths

Possible solo advantages:

- lower visibility
- smaller PvE aggro radius
- faster extraction
- easier movement
- full ownership of loot
- easier access to small or hidden routes
- less coordination burden

## 16.2 Group Strengths

Group advantages:

- coordinated combat
- role specialization
- ability to protect a valuable carrier
- safer boss fights
- ability to recover dropped teammate loot
- better control of contested extraction areas

## 16.3 Balance Rule

Groups should be stronger in direct combat.

Solo players should be:

- harder to detect
- faster to extract
- more efficient
- better at avoiding conflict

The game should not pretend one solo player and three coordinated players are equal in a direct fight. Balance should instead provide different strengths and survival strategies.

---

# 17. Extraction System

## 17.1 Basic Rule

Extraction points:

- appear at random valid map locations
- remain active for a limited time
- disappear after expiration
- reopen elsewhere
- are visible on the map
- require a short uninterrupted channel

Suggested first-version values:

- two active extraction points
- 45 to 90 seconds active duration
- 4 to 6 seconds extraction channel
- taking damage interrupts extraction
- successful extraction immediately ends the run for that player

Exact values require testing.

## 17.2 Extraction Risk

Activating extraction should:

- create a visible effect
- create an audible signal
- notify nearby players
- make camping possible but not effortless

## 17.3 Future Extractor Types

After the basic system is proven, different extractors may offer point bonuses.

Examples:

- Force-focused extractor
- Precision-focused extractor
- Motion-focused extractor
- Guard-focused extractor
- Signal-focused extractor
- neutral extractor

This is not required for the first playable version.

---

# 18. Visibility and Greed

A future or early-supporting system may make valuable players easier to detect.

Possible scaling:

- low carried value: no special visibility
- medium carried value: subtle aura or nearby audio
- high carried value: visible regional signal
- extreme carried value: approximate map marker

This system supports:

- risk escalation
- PvP hunting
- tension around wealthy players
- anti-camping pressure

It should be tested after the basic loot and extraction loop works.

---

# 19. Item Types

## 19.1 Ordinary Point Items

Purpose:

- temporary build power
- permanent point conversion

Properties:

- fixed five-category values
- simple icon
- fixed rarity
- no random affixes

## 19.2 Weapon Blueprint

Purpose:

- unlock a starting weapon permanently

On duplicate:

- convert to points or mastery progress

## 19.3 Armor Blueprint

Purpose:

- unlock a starting armor type permanently

On duplicate:

- convert to points or mastery progress

## 19.4 Skill Core

Purpose:

- unlock a permanent skill

May come from:

- bosses
- elite enemies
- rare map objectives

## 19.5 Temporary Weapon

Purpose:

- replace the current equipped weapon during the run

Rules:

- one equipped weapon
- no weapon backpack initially
- old weapon may be dropped or salvaged
- temporary weapon disappears after run end

## 19.6 Temporary Armor

Purpose:

- replace current armor during the run

Initial implementation may omit temporary armor replacement if it complicates balance.

---

# 20. Equipment Swap Rules

When finding a weapon, the player may:

1. equip it
2. leave it
3. salvage it into a normal point item

The initial game should not support:

- carrying multiple unequipped weapons
- carrying backup armor
- weapon durability
- attachment slots
- ammunition inventory

One weapon slot keeps the system understandable.

---

# 21. Map Design

## 21.1 Initial Map

The first map should be:

- top-down
- compact
- readable
- divided into simple zones
- designed for 8 to 12 players initially
- large enough to avoid constant forced PvP
- small enough to produce encounters

## 21.2 Suggested Areas

- spawn regions
- low-risk PvE areas
- higher-value central areas
- boss arena
- extraction-valid locations
- simple walls and obstacles
- limited cover
- a few narrow routes

## 21.3 Spawn Rules

Players should:

- spawn away from immediate combat
- receive brief spawn protection
- not be able to damage others during protection
- lose protection after moving, attacking, or a short timer

---

# 22. Match Structure

## 22.1 Player Count

Initial target:

- 8 to 12 players per room

Later target:

- 20 players per room after stability testing

Do not begin at 40 or more.

## 22.2 Join Timing

Initial options:

### Option A: Match Start Together
- easier to balance
- easier to test
- less seamless

### Option B: Join Active Room
- faster entry
- more .io-like
- harder to balance

Recommended first version:

- fixed match start or short lobby countdown

Active-room joining can be added later.

## 22.3 Match End

A match ends when:

- time limit expires
- all players have extracted or died
- optional final extraction closes

Suggested initial maximum match duration:

- 12 minutes

---

# 23. User Interface

## 23.1 In-Match HUD

The HUD should show:

- health
- dash cooldown
- weapon
- armor
- three permanent equipped skills
- temporary wildcard skill
- six inventory slots
- one secure slot
- current five-category totals
- extraction markers
- simplified minimap
- party status

## 23.2 Lobby UI

The lobby should show:

- play button
- solo or party choice
- starting weapon
- starting armor
- three skill slots
- progression points
- unlock menu
- loadout presets
- account identity
- simple statistics

## 23.3 Inventory UI

The inventory should allow:

- drag item between normal slots
- move item to secure slot
- discard item
- compare fixed point values
- view current build impact

The secure-slot action should require clear confirmation because it is irreversible during the run in the initial version.

---

# 24. Visual Direction

## 24.1 Style

The game should use:

- simple 2D top-down graphics
- clean silhouettes
- limited animation
- readable color coding
- modular visual effects
- lightweight assets

Possible styles:

- minimalist science fantasy
- clean dark fantasy
- stylized post-apocalyptic
- geometric magical technology

The theme remains open, but the visual implementation must stay simple.

## 24.2 Asset Requirements

Initial assets should be limited to:

- one player base sprite
- color or equipment variations
- four weapon visuals
- three armor visuals
- three enemy sprites
- one boss sprite
- item icons
- extraction effects
- basic map tiles
- simple attack effects

The game should avoid requiring hundreds of unique character animations.

---

# 25. Audio Direction

Initial audio should include:

- melee hit
- ranged attack
- enemy hit
- player damage
- loot pickup
- rare loot pickup
- secure-slot action
- extraction activation
- extraction success
- player death
- boss alert

Audio should communicate gameplay states more than provide cinematic atmosphere.

---

# 26. Initial Content Budget

The first meaningful prototype should contain no more than:

- 4 weapon types
- 3 armor types
- 15 normal skills
- 3 boss skills
- 15 ordinary loot items
- 3 PvE enemy types
- 1 boss
- 1 map
- 8 to 12 players
- 6 normal inventory slots
- 1 secure slot
- 2 active extraction points
- 5 permanent point categories
- 1 temporary wildcard skill slot

This budget is a hard scope target, not a suggestion to quietly double everything.

---

# 27. MVP Feature Tiers

## 27.1 Prototype Tier 1: Local Combat

Required:

- player movement
- aiming
- melee attack
- ranged attack
- simple enemy AI
- health and death
- loot pickup
- six-slot inventory
- secure slot
- basic extraction

No multiplayer is required.

## 27.2 Prototype Tier 2: Build System

Required:

- five-category loot values
- carried loot modifies combat
- three pre-run skills
- tagged skill compatibility
- hard effect caps
- temporary wildcard skill
- point conversion after extraction or death

## 27.3 Prototype Tier 3: Multiplayer

Required:

- one room
- 8 players
- synchronized movement
- server-authoritative damage
- server-controlled enemies
- player death
- dropped loot
- extraction
- party identifiers

## 27.4 Prototype Tier 4: Accounts and Unlocks

Required:

- guest identity
- optional registered account
- permanent point balances
- weapon unlocks
- armor unlocks
- skill unlocks
- loadout presets
- match result persistence

## 27.5 Prototype Tier 5: Boss and Rare Progression

Required:

- one boss
- boss skill core
- secure-or-use decision
- permanent boss skill unlock
- duplicate conversion

---

# 28. Data-Driven Content Requirements

Content should be stored separately from engine logic where practical.

Suggested data files:

```text
weapons.json
armors.json
skills.json
loot_items.json
enemies.json
bosses.json
extractors.json
unlock_tree.json
balance_constants.json
```

Each content entry should define:

- unique ID
- display name
- tags
- compatibility
- effect values
- rarity
- unlock cost
- visual reference
- audio reference
- hard limits where needed

Avoid hard-coding content-specific behavior unless the mechanic cannot reasonably be represented using shared primitives.

---

# 29. Example Data Definitions

## 29.1 Weapon

```yaml
id: basic_bow
name: Basic Bow
category: ranged
tags:
  - Projectile
base_stats:
  damage: 10
  attack_interval_ms: 650
  projectile_speed: 600
  projectile_count: 1
  spread_degrees: 0
limits:
  max_projectiles_per_attack: 8
  max_bounces: 3
  max_pierces: 3
```

## 29.2 Skill

```yaml
id: ricochet
name: Ricochet
slot_cost: 1
requires_tags:
  - Projectile
effects:
  bounce_count_add: 1
  damage_after_bounce_multiplier: 0.8
limits:
  maximum_total_bounces: 3
```

## 29.3 Loot Item

```yaml
id: targeting_core
name: Targeting Core
rarity: uncommon
points:
  force: 0
  precision: 2
  motion: 1
  guard: 0
  signal: 4
build_effects:
  projectile_homing_add: 0.05
  detection_radius_add: 25
```

## 29.4 Boss Skill Core

```yaml
id: split_return_core
name: Split Return Core
rarity: boss
temporary_skill_id: split_return
permanent_unlock_id: skill_split_return
secure_slot_allowed: true
duplicate_conversion:
  signal: 5
  precision: 3
```

---

# 30. Balance Principles

## 30.1 Permanent Power

Permanent upgrades should:

- improve flexibility
- unlock alternatives
- provide modest mastery
- avoid large raw-stat advantages

## 30.2 Loot Power

Carried loot should:

- noticeably affect the current build
- remain capped
- create specialization
- avoid instant unstoppable snowballing

## 30.3 Secure Slot

The secure slot should:

- guarantee limited progress
- reduce current power when used
- remain valuable but not mandatory
- prevent total frustration after death

## 30.4 PvP Rewards

Killing another player should:

- provide access to dropped normal inventory
- create risk through carrying more loot
- not automatically grant account progress
- require extraction or secure-slot use to keep rewards

## 30.5 Default Equipment

Default equipment must:

- remain viable
- support skill combinations
- not become intentionally weak
- permit experienced play without rare unlocks

---

# 31. Anti-Snowball Principles

The game should prevent one successful player from becoming permanently unbeatable during a match.

Possible controls:

- diminishing returns from carried points
- projectile and effect caps
- visibility increase with carried value
- stronger PvE attraction to high-value players
- longer extraction time for high-value carriers
- limited healing
- no unlimited armor stacking
- no recursive skill combinations

Only a subset should be implemented initially.

---

# 32. Failure States and Edge Cases

The implementation must define behavior for:

- player disconnects during combat
- player disconnects during extraction
- party member disconnects
- two players looting the same item
- extraction point disappearing during channel
- secure-slot item on server crash
- duplicate unlock reward
- full inventory pickup
- full secure slot
- swapping weapons near death
- temporary skill replacement
- boss death with multiple contributors
- simultaneous player deaths
- loot ownership timing
- match shutdown
- reconnect attempts

Technical resolution is deferred, but these cases must not be ignored during implementation planning.

---

# 33. Design Decisions Already Approved

The following decisions are considered current baseline:

- no in-run leveling
- no Archero-style random level-up draft
- three permanent skill slots
- one temporary wildcard skill slot
- one starting weapon
- one armor slot
- melee and ranged combat
- six normal inventory slots
- one secure inventory slot
- secure items stop providing active power
- secure items survive death
- ordinary secured items convert automatically
- no persistent ordinary item stash
- loot uses five point categories
- loot powers the current build
- extraction points move over time
- death drops normal inventory
- other players may loot the body
- solo and party play share the same map
- party size target is three
- PvE and PvP coexist
- default gear remains balanced
- permanent progression unlocks choices
- Codex or Claude Code feasibility is a core design constraint

---

# 34. Deferred Decisions

The following require later design or technical analysis:

- exact visual theme
- final game title
- exact point-category names
- fixed match start versus join-in-progress
- exact player count at launch
- account provider and login method
- deployment platform
- networking framework
- server-authoritative model
- database
- anti-cheat approach
- reconnect behavior
- mobile support
- monetization
- cosmetics
- matchmaking
- region selection
- party invitation method
- exact extraction timers
- exact skill list
- exact weapon balance
- whether temporary armor drops are included
- whether wealthy players become more visible
- whether a second secure slot can be unlocked
- whether rare skills consume two slots
- whether downed-state revives are added later

---

# 35. Success Criteria for the Core Prototype

The prototype is successful only if:

1. Combat feels readable and responsive.
2. Loot choices visibly change the current build.
3. Moving an item into the secure slot creates a meaningful decision.
4. Extraction creates tension without requiring complex objectives.
5. Melee and ranged builds are both viable.
6. Skill combinations are understandable.
7. Death feels costly but does not make the session feel pointless.
8. Solo players can survive without joining a party.
9. Parties are useful but not unbeatable.
10. The game remains understandable after a short tutorial.
11. A new content item can be added mostly through data.
12. Automated tests can cover major rules.
13. The codebase remains modular enough for Codex or Claude Code to modify safely.

---

# 36. One-Sentence Pitch

> **A lightweight multiplayer extraction roguelite where players enter with a chosen weapon, armor, and skill combination, become stronger through the loot they carry, and must decide what to risk, what to secure, and when to escape.**

---

# 37. Short Store Description

Enter alone or with a small party. Fight creatures, collect powerful loot, and clash with other players across a shared top-down map. Every item you carry changes your current build, but everything in normal inventory is lost when you die. Lock one valuable item into your secure slot, sacrifice its immediate power, and guarantee permanent progress. Find an extraction point before it disappears, escape with your loot, and unlock new weapons, armor, and skill combinations for future runs.

---

# 38. Guidance for Codex and Claude Code

When implementing this project:

1. Treat this document as the design baseline.
2. Do not add unapproved systems.
3. Do not introduce in-run leveling.
4. Do not create a persistent ordinary item stash.
5. Prefer reusable shared mechanics over unique one-off code.
6. Keep content data-driven.
7. Add automated tests for every major rule.
8. Implement one milestone at a time.
9. Preserve scope boundaries.
10. Document assumptions when requirements are incomplete.
11. Do not rewrite unrelated systems during feature work.
12. Validate multiplayer rules on the server.
13. Keep visual effects lightweight.
14. Enforce hard limits on projectile and effect combinations.
15. Prioritize a playable loop over content quantity.

---

# 39. Next Document

The next design document should cover technical planning:

- recommended engine and frontend stack
- multiplayer networking model
- backend services
- account and authentication system
- database design
- deployment options
- regional server strategy
- game-room lifecycle
- hosting costs
- anti-cheat boundaries
- testing strategy
- CI/CD
- analytics
- moderation
- production milestones
- how players access and play the game

That technical plan should preserve the scope and rules defined here.
