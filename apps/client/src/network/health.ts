/**
 * Client-side health probe. The client fetches the server's HTTP `/health`
 * endpoint to prove the server is reachable over HTTP, independent of the
 * WebSocket connection (technical plan §38 M0 exit criteria: "client can reach
 * health endpoint"). The response crosses a network boundary, so it is validated
 * before it is trusted or displayed.
 */
import { HEALTH_PATH, type HealthResponse, validateHealthResponse } from "@carry-or-fall/protocol";

export type HealthStatus =
  | { readonly reachable: true; readonly health: HealthResponse }
  | { readonly reachable: false; readonly detail: string };

/**
 * Derive the HTTP(S) health URL from the WS(S) game-server URL. The client is
 * configured with a WebSocket URL for the room connection; the health endpoint
 * lives at the same host over HTTP(S).
 */
export function toHealthUrl(serverUrl: string): string {
  const httpBase = serverUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  return new URL(HEALTH_PATH, httpBase).toString();
}

/** Fetch and validate the server health endpoint. Never throws; reports failures. */
export async function checkServerHealth(serverUrl: string): Promise<HealthStatus> {
  try {
    const response = await fetch(toHealthUrl(serverUrl));
    if (!response.ok) {
      return { reachable: false, detail: `health returned HTTP ${String(response.status)}` };
    }

    const body: unknown = await response.json();
    const result = validateHealthResponse(body);
    if (!result.ok) {
      return { reachable: false, detail: result.error };
    }

    return { reachable: true, health: result.value };
  } catch (error) {
    return { reachable: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
