/**
 * Shared client/server payload shapes.
 *
 * At join time the only thing a client tells the server is who it is: the
 * version handshake below, supplied as Colyseus *join options* so the server
 * can refuse an incompatible client before it ever occupies a seat (see the
 * technical plan §35). M1 adds the first post-join message shape,
 * {@link InputMessage}; it has no network transport until M4 (there is no
 * server gameplay in M1 — see `docs/M1_EXECUTION_PLAN.md` §5, §6).
 */

/**
 * Version handshake the client supplies as Colyseus join options. It reports only
 * information the client legitimately owns; the server never trusts a client for
 * anything beyond identifying its version. The server validates this at the join
 * boundary and rejects a malformed or incompatible client.
 */
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly buildVersion: string;
}

/**
 * Read model of the synchronized foundation-room state. This mirrors the fields
 * of the server-side Colyseus schema so the client can type `room.state` without
 * depending on `@colyseus/schema`. The server remains the sole authority over
 * these values; the client only ever reads them.
 */
export interface FoundationRoomState {
  readonly serverBuildVersion: string;
  readonly connectedPlayers: number;
}

/**
 * Message-type identifier for {@link InputMessage}, the first post-join message
 * (docs/PROTOCOL.md §6). M1 consumes it in-process (no network exists yet); M4
 * reuses the same constant when it becomes an authoritative Colyseus message.
 */
export const INPUT_MESSAGE_TYPE = "input";

/**
 * Player input intent, matching docs/PROTOCOL.md §6 and the technical plan
 * §10.2 shape exactly. The client reports only intent — which keys are held,
 * where the player aims, which actions were requested — never an outcome (see
 * `docs/DEVELOPMENT_RULES.md`, "Architecture and authority"). `sequence` is
 * reserved for future client/server reconciliation (technical plan §11.2); it
 * has no meaning yet since M1 has no network.
 *
 * The runtime validator (`validateInputMessage`) is deliberately deferred to
 * M4, the first milestone with an untrusted network boundary for it to guard
 * (`docs/DECISIONS.md` D23).
 */
export interface InputMessage {
  readonly sequence: number;
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number;
  readonly attackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}
