/**
 * HTTP contract shared by the client and the authoritative server. M0 exposes a
 * single health endpoint; the client fetches it to prove the server is reachable
 * over HTTP (technical plan §38 M0 exit criteria: "client can reach health
 * endpoint"). Kept framework-agnostic so both ends share one source of truth.
 */

/** Path of the server health endpoint, relative to the server origin. */
export const HEALTH_PATH = "/health";

/**
 * Body returned by {@link HEALTH_PATH}. It reports the server build and protocol
 * versions so the client can display them and detect a version mismatch early.
 */
export interface HealthResponse {
  readonly status: "ok";
  readonly buildVersion: string;
  readonly protocolVersion: number;
  readonly uptime: number;
}
