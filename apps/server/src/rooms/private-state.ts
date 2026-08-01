/**
 * The private half of a player's state (M4.4, technical plan §10.3: "private
 * player data must be filtered … other clients do not need to receive another
 * player's complete inventory").
 *
 * Inventory, secure slot, skill loadout, wildcard skill, and run result are not
 * in the synchronized schema at all (`MatchState.ts`), so there is nothing to
 * filter and no filter to get wrong. Instead each client is sent its own
 * `LocalPlayerState` — and only its own — whenever it changes.
 *
 * Items and skills travel as content ids, not as copied definitions: the client
 * already has the same content tables (and the join handshake refuses it if it
 * does not, `docs/DECISIONS.md` D34), so sending ids keeps the message small and
 * keeps the server from shipping content data as if it were state.
 */
import type { LocalPlayerState, RunResultPayload } from "@carry-or-fall/protocol";
import type { Player } from "@carry-or-fall/simulation-core";

/** Build the private state message for one player. */
export function toLocalPlayerState(player: Player): LocalPlayerState {
  return {
    playerId: player.id,
    inventory: player.inventory.map((item) => item?.id ?? null),
    secureSlotItemId: player.secureSlot?.id ?? null,
    skillIds: player.skillLoadout.map((skill) => skill.id),
    wildcardSkillId: player.wildcardSkill?.id ?? null,
    runResult: toRunResultPayload(player),
  };
}

function toRunResultPayload(player: Player): RunResultPayload | null {
  const result = player.runResult;
  if (result === null) {
    return null;
  }
  return {
    outcome: result.outcome,
    pointsGained: { ...result.pointsGained },
    itemsConverted: result.itemsConverted,
    itemsLost: result.itemsLost,
  };
}

/**
 * A cheap value that changes exactly when {@link toLocalPlayerState} would
 * produce something different, so the room can skip resending unchanged private
 * state every tick. Comparing the serialized message itself would be correct
 * too; this is the same thing without allocating the message first.
 */
export function privateStateSignature(player: Player): string {
  const inventory = player.inventory.map((item) => item?.id ?? "-").join(",");
  const outcome = player.runResult === null ? "-" : player.runResult.outcome;
  return [
    inventory,
    player.secureSlot?.id ?? "-",
    player.skillLoadout.map((skill) => skill.id).join(","),
    player.wildcardSkill?.id ?? "-",
    outcome,
  ].join("|");
}
