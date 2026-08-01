/**
 * The version gate both rooms run at join time (technical plan §35,
 * `docs/DECISIONS.md` D18, D34).
 *
 * It exists as one function rather than two copies because M4 added a second
 * room: `foundation_room` (the connection-only probe) and `match_room` must
 * never disagree about which clients they admit, and the cheapest way to
 * guarantee that is for there to be exactly one implementation of the rule
 * (`docs/DECISIONS.md` D40).
 *
 * The reported versions gate compatibility only. Nothing here is ever trusted
 * as game state.
 */
import { CONTENT_VERSION } from "@carry-or-fall/game-content";
import {
  type ClientHandshake,
  INCOMPATIBLE_CLIENT_MESSAGE,
  isContentCompatible,
  isProtocolCompatible,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_VERSION,
  validateClientHandshake,
} from "@carry-or-fall/protocol";
import { ServerError } from "@colyseus/core";

import type { Logger } from "../logger";

/**
 * Validate and version-check an untrusted join-options payload. Throws
 * `ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE)` — which
 * Colyseus turns into a refused join carrying the refresh/update message — for
 * a malformed handshake or an incompatible protocol or content version.
 * Returns the validated handshake otherwise.
 */
export function authorizeHandshake(
  options: unknown,
  sessionId: string,
  logger: Logger,
): ClientHandshake {
  const result = validateClientHandshake(options);
  if (!result.ok) {
    logger.warn("refused malformed client handshake", { sessionId, error: result.error });
    throw new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE);
  }

  if (!isProtocolCompatible(result.value.protocolVersion)) {
    logger.warn("refused incompatible client protocol", {
      sessionId,
      clientProtocol: result.value.protocolVersion,
      serverProtocol: PROTOCOL_VERSION,
    });
    throw new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE);
  }

  if (!isContentCompatible(result.value.contentVersion, CONTENT_VERSION)) {
    // A client with different content tables would draw arcs, projectile
    // behavior, and point previews that disagree with the outcomes this server
    // computes (`docs/DECISIONS.md` D34).
    logger.warn("refused incompatible client content", {
      sessionId,
      clientContent: result.value.contentVersion,
      serverContent: CONTENT_VERSION,
    });
    throw new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE);
  }

  logger.info("accepted client handshake", {
    sessionId,
    clientProtocol: result.value.protocolVersion,
    clientContent: result.value.contentVersion,
    clientBuildVersion: result.value.buildVersion,
  });
  return result.value;
}
