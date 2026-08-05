> **Draft, not authoritative.** A starting point for M7A planning. Where it conflicts
> with the concept document or the technical plan, those win. Several designs here
> assume a single player and do not survive translation to a room of two to eight; see
> docs/M7A_ISSUES.md for which, and for what was deferred and why.

# 2D Pixel Action Shooter: Enemy AI Mechanics Design

This document outlines the core AI behaviors, roles, and combat mechanics for enemies
in the game. It is designed to encourage dynamic combat, forcing the player to utilize
both melee and ranged systems effectively.

## 1. Melee Mechanics

Melee enemies are designed to pressure the player, close distances, and disrupt
movement.

### Swarm / Chaser (Slime Type)
* **Mechanism:** Instead of standard melee strikes, these enemies latch onto the player
  upon contact. Once attached, they significantly reduce the player's movement speed
  and deal continuous Damage over Time (DoT).
* **Role:** Acts as a sticky obstacle that drains resources and slows the player down,
  making them vulnerable to other threats.

### Dasher
* **Mechanism:** When the player aligns on their X or Y axis, the Dasher stops briefly
  to display a telegraph (warning line/pre-delay), then executes an extremely
  high-speed linear dash.
* **Special Interaction:** If the Dasher collides with a wall during the dash, it
  becomes Stunned for a short duration, creating a counter-attack window.

### Shield / Tank (Active Parry System)
* **Parry Mechanism Definition:** This monster actively parries incoming attacks from
  its front. Parrying is restricted to frontal attacks only.
* **Vs. Player Melee Attack:** If it successfully parries a melee attack, the player
  takes damage and is **Stunned for 2 seconds**.
* **Vs. Player Ranged Attack:** If it successfully parries a ranged projectile, the
  attack is reflected back at the player. The reflected projectile travels at **2x
  speed** and deals **2x damage**.
* **Cooldown:** The parry ability has a strict **5-second cooldown**.
* **Counterplay:** Attack from behind (flanking) or bait the parry and burst damage
  during the 5-second cooldown window.

### Hit & Run / Skirmisher
* **Mechanism:** Approaches the player to perform a moderately long, forward linear
  stabbing attack. Immediately after striking (or missing), it performs a large
  backstep or diagonal evasion to disengage.
* **Role:** Punishes missed attacks and disrupts the player's combat tempo by evading
  counter-attacks.

### Ambusher (Stealth/Trap Type)
Remains in a semi-transparent (stealthed) state, waiting for the player to enter its
aggro range.
* **Ambusher 1:** Upon triggering, it executes a melee attack that inflicts **Poison
  (DoT)**, then immediately flees.
* **Ambusher 2:** Upon triggering, it inflicts a **2-second Stun** and **Poison (DoT)**
  simultaneously, then immediately flees.

## 2. Ranged Mechanics

Ranged enemies control spatial positioning and test the player's evasion skills.

### Standard Shooter (Basic Ranged)
* **Mechanism:** Fires projectiles that are identical in behavior to the player's basic
  ranged attack.
* **Role:** Serves as the fundamental baseline ranged enemy.

### Suppression / Bullet Hell
* **Mechanism:** Fires dense clusters of slow-moving projectiles (e.g., spread,
  fan-shaped, or circular patterns) continuously.
* **Role:** Limits the player's pathing, forcing them into corners or restricting safe
  zones rather than aiming for direct precision hits.

### Grenadier / Artillery
* **Mechanism:** Hides behind cover and lobs projectiles (grenades, poison flasks,
  etc.) in an arcing trajectory that ignores terrain and walls. Impact creates AoE
  explosions or lingering hazard zones.
* **Role:** An anti-camping unit that forces players out from behind safe cover.

### Homing
* **Mechanism:** Fires guided projectiles that continuously track the player for a set
  duration.
* **Counterplay:** The player can shoot and destroy these homing projectiles mid-air,
  maintaining action fluidity without feeling unfairly punished.

### Trapper
* **Mechanism:** Does not aim directly at the player. Instead, it deploys proximity
  mines or sticky traps (heavy slow effect) along the player's predicted movement paths
  or surrounding floors.

## 3. Utility / Support Mechanics

High-priority targets that alter the combat flow and buff other enemies.

### Buffer 1 (Speed Enhancer)
* **Mechanism:** Channels a movement speed buff onto a single allied monster.
* **Limitation:** It can only buff one target at a time and remains completely immobile
  (rooted) while channeling.

### Healer 1
* **Mechanism:** Acts as a dedicated medic, continuously restoring the HP of allied
  monsters in its vicinity.
* **Role:** Must be prioritized and eliminated first to prevent prolonged fights.

### Summoner / Spawner
* **Mechanism:** Actively flees and maintains a safe distance from the player.
  Periodically spawns 'Swarm / Chaser' minions into the arena.
* **Role:** Creates a soft enrage timer; if left unchecked, the map will be overwhelmed
  with minions.

## 4. Boss Encounter Concepts

This document outlines the design for 4 distinct bosses. True to the game's core
philosophy, these bosses rely on simple, clean mechanics and do not require complex
animations or elaborate environmental interactions. Each boss features a distinct Phase
2 that triggers at **50% HP**.

## Boss 1: The Juggernaut (Heavy Charger)
**Concept:** A massive, slow-moving bruiser that punishes greedy players with sudden,
lightning-fast dashes.
* **Movement:** Walks very slowly towards the player.
* **Main Attack (The Dash):** Stops abruptly, flashes red for 1 second (telegraph), and
  executes a high-speed, high-damage linear dash across the screen. The speed requires
  precise evasion timing from the player.
* **Defense Mechanism (Invincibility):** Immediately after completing a dash, the boss
  enters a "cooling down" defensive stance for 3 seconds where it becomes completely
  **Invincible**. The player must wait for the boss to start walking again to deal
  damage.
* **Phase 2 (At 50% HP) - "Chain Dash":**
  * The boss no longer just dashes once.
  * It now executes a **Double Dash**. After the first dash, it immediately re-targets
    the player and dashes a second time with a shorter telegraph (0.5 seconds) before
    entering its invincible cooldown state.

## Boss 2: The Gunner (Bullet Hell Kiter)
**Concept:** A highly mobile shooter that strictly maintains distance, filling the
screen with projectiles to test the player's spatial awareness.
* **Movement:** Extremely fast. Constantly moves in the opposite direction of the player
  to maintain maximum distance.
* **Main Attack (Bullet Hell):** Fires a continuous, wide fan of slow-moving
  projectiles. The bullets are dense enough that the player must carefully thread the
  needle to approach.
* **Phase 2 (At 50% HP) - "Sniper's Mix":**
  * The boss continues firing the slow-moving bullet hell pattern, but adds a new
    threat.
  * Every few seconds, it fires a single, **high-speed predictive projectile** (like the
    Predictive Sniper enemy). The player is forced to make sudden evasive maneuvers to
    dodge the fast bullet while still navigating the slow-moving bullet maze.

## Boss 3: The Hive Mother (Summoner & Trapper)
**Concept:** A boss that avoids direct confrontation, overwhelming the player by
controlling the arena space and action economy.
* **Movement:** Warps or dashes quickly to a random corner of the room when the player
  gets too close.
* **Main Attack (Spawn & Trap):**
  * Periodically spawns 2 **"Swarm / Chaser" (Slime)** enemies that latch onto the
    player.
  * Throws stationary **Poison Traps** randomly around the arena that deal DoT and slow
    the player if stepped on.
* **Phase 2 (At 50% HP) - "Homing Swarm":**
  * The boss increases the spawn rate of the Slimes.
  * Instead of just throwing stationary traps, the boss now fires **Homing Projectiles**
    (which can be destroyed by the player's attacks) while continuing to run away. The
    player must manage slimes, destroy homing missiles, and chase down the boss
    simultaneously.

## Boss 4: The Phantom (Stealth Ambusher)
**Concept:** A fragile but deadly assassin that uses stealth to deliver massive burst
damage, testing the player's reaction time.
* **Movement:** Remains in a **semi-transparent (stealthed)** state where it cannot be
  targeted or damaged, slowly stalking the player.
* **Main Attack (Ambush Sweep):**
  * Suddenly materializes right next to the player, performs a quick, wide melee sweep
    (high damage), and immediately fades back into stealth.
  * The player has a very brief window (about 1.5 seconds) to attack the boss while it
    is fully visible during and right after its attack.
* **Phase 2 (At 50% HP) - "Toxic Aftermath":**
  * The attack speed of the ambush sweep becomes slightly faster.
  * Every time the boss fades back into stealth after attacking, it leaves behind a
    large, lingering **Poison Cloud** at that exact location. As the fight drags on, the
    arena becomes filled with toxic zones, heavily restricting the player's safe
    movement area.
