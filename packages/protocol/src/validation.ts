import { HealthResponse } from "./http";
import { ClientHandshake } from "./messages";
import { isBuildVersion } from "./version";

/**
 * Result of validating an untrusted value. A discriminated union so callers must
 * check `ok` before reading `value`, and get a human-readable `error` otherwise.
 */
export type ValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A protocol version is a small positive integer; reject anything else outright
// rather than coercing, so a malformed or hostile payload cannot slip through.
const MAX_PROTOCOL_VERSION = 1_000_000;

function isProtocolVersionValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PROTOCOL_VERSION
  );
}

/**
 * Validate an untrusted client handshake (Colyseus join options). This is the
 * network-boundary check the server runs before admitting a client: it enforces
 * shape, types, and ranges before any field is trusted, and never mutates or
 * coerces the input.
 */
export function validateClientHandshake(input: unknown): ValidationResult<ClientHandshake> {
  if (!isRecord(input)) {
    return fail("client handshake must be an object");
  }

  if (!isProtocolVersionValue(input["protocolVersion"])) {
    return fail("client handshake protocolVersion must be a positive integer");
  }

  if (!isBuildVersion(input["buildVersion"])) {
    return fail("client handshake buildVersion must be a valid build version string");
  }

  return ok({
    protocolVersion: input["protocolVersion"],
    buildVersion: input["buildVersion"],
  });
}

/**
 * Validate an untrusted health-endpoint response. The client fetches `/health`
 * over HTTP (a network boundary), so the body is validated before it is trusted
 * or displayed, exactly like a message received over the socket.
 */
export function validateHealthResponse(input: unknown): ValidationResult<HealthResponse> {
  if (!isRecord(input)) {
    return fail("health response must be an object");
  }

  if (input["status"] !== "ok") {
    return fail('health response status must be "ok"');
  }

  if (!isBuildVersion(input["buildVersion"])) {
    return fail("health response buildVersion must be a valid build version string");
  }

  if (!isProtocolVersionValue(input["protocolVersion"])) {
    return fail("health response protocolVersion must be a positive integer");
  }

  const uptime = input["uptime"];
  if (typeof uptime !== "number" || !Number.isFinite(uptime) || uptime < 0) {
    return fail("health response uptime must be a non-negative number");
  }

  return ok({
    status: "ok",
    buildVersion: input["buildVersion"],
    protocolVersion: input["protocolVersion"],
    uptime,
  });
}
