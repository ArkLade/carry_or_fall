import { ClientHelloPayload } from "./messages";
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
 * Validate an untrusted `client_hello` payload. This is the network-boundary
 * check for the only client message in M0: it enforces shape, types, and ranges
 * before any field is trusted, and never mutates or coerces the input.
 */
export function validateClientHello(input: unknown): ValidationResult<ClientHelloPayload> {
  if (!isRecord(input)) {
    return fail("client_hello payload must be an object");
  }

  if (!isProtocolVersionValue(input["protocolVersion"])) {
    return fail("client_hello.protocolVersion must be a positive integer");
  }

  if (!isBuildVersion(input["buildVersion"])) {
    return fail("client_hello.buildVersion must be a valid build version string");
  }

  return ok({
    protocolVersion: input["protocolVersion"],
    buildVersion: input["buildVersion"],
  });
}
