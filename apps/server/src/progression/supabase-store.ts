/**
 * The real {@link ProgressionStore}, backed by Supabase/PostgreSQL (M5.4,
 * `docs/M5_ISSUES.md` §5).
 *
 * Every method is one RPC call to one function in
 * `supabase/migrations/0002_settlement_functions.sql`. There is deliberately no
 * ad-hoc `update` against `point_balances` and no multi-statement sequence here:
 * the atomicity and the exactly-once guarantee live inside those functions, in
 * one transaction each, and a second implementation of them in TypeScript would
 * be a second place for them to be wrong.
 *
 * The client is constructed with the **secret key**, whose `service_role`
 * bypasses row-level security — that is what lets the server write tables no
 * browser policy permits (`docs/DATA_MODEL.md` §5.2). Two consequences this file
 * is responsible for:
 *
 * - The key never leaves this process. It is not logged here, not attached to an
 *   error, and not returned by any method.
 * - `persistSession`/`autoRefreshToken` are off. This client authenticates with
 *   a static key and has no user session; leaving the defaults on would have it
 *   writing session storage on a server.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountSnapshot,
  Balances,
  PendingReservation,
  ProgressionStore,
  ReservationResult,
  SettlementRequest,
  SettlementResult,
  UnlockGrant,
} from "./store";
import { ZERO_BALANCES } from "./store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  // PostgreSQL `bigint` arrives as a number or a string depending on magnitude;
  // both are accepted, anything else is zero rather than NaN propagating into a
  // balance.
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBalances(value: unknown): Balances {
  if (!isRecord(value)) {
    return { ...ZERO_BALANCES };
  }
  return {
    force: toNumber(value["force"]),
    precision: toNumber(value["precision"]),
    motion: toNumber(value["motion"]),
    guard: toNumber(value["guard"]),
    signal: toNumber(value["signal"]),
  };
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toUnlockPayload(unlocks: readonly UnlockGrant[]): readonly Record<string, string>[] {
  return unlocks.map((grant) => ({
    unlock_id: grant.unlockId,
    unlock_type: grant.unlockType,
  }));
}

/**
 * What a PostgREST call returns, once. Without a generated `Database` type the
 * Supabase client types `data` as `any`, which would spread untyped values
 * through every method below. Narrowing it to `unknown` **at this one boundary**
 * is what forces the `toBalances`/`toStringArray` guards to actually run — the
 * same "validate at the boundary, once" shape the protocol package uses for
 * client messages.
 */
interface RpcResponse {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

export class SupabaseStore implements ProgressionStore {
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string) {
    // `createClient` is generic over a `Database` type this project does not
    // generate, so its default instantiation does not match the plain
    // `SupabaseClient` alias. The cast pins one type for the field; every value
    // that comes *out* of it is still narrowed from `unknown` by `rpc` below,
    // which is where the real safety is.
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as SupabaseClient;
  }

  /** Exposed so `auth.ts` verifies tokens through the same configured client. */
  get authClient(): SupabaseClient {
    return this.client;
  }

  /** Call one SQL function, failing loudly, with the response narrowed to `unknown`. */
  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const response = (await this.client.rpc(name, args)) as RpcResponse;
    if (response.error !== null) {
      throw new Error(`${name} failed: ${response.error.message}`);
    }
    return isRecord(response.data) ? response.data : {};
  }

  async ensureAccount(
    userId: string,
    displayName: string,
    defaultUnlocks: readonly UnlockGrant[],
  ): Promise<AccountSnapshot> {
    const data = await this.rpc("ensure_account", {
      p_user_id: userId,
      p_display_name: displayName,
      p_default_unlocks: toUnlockPayload(defaultUnlocks),
    });
    return {
      userId,
      balances: toBalances(data["balances"]),
      unlockIds: toStringArray(data["unlock_ids"]),
    };
  }

  /**
   * Read an account **without** provisioning one. Deliberately not routed
   * through `ensure_account`: that would create a profile as a side effect of
   * looking, and `null` here has a meaning the caller relies on — this user has
   * no account yet.
   */
  async loadAccount(userId: string): Promise<AccountSnapshot | null> {
    const balances = (await this.client
      .from("point_balances")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()) as RpcResponse;
    if (balances.error !== null) {
      throw new Error(`loadAccount balances failed: ${balances.error.message}`);
    }
    if (!isRecord(balances.data)) {
      return null;
    }

    const unlocks = (await this.client
      .from("unlocks")
      .select("unlock_id")
      .eq("user_id", userId)) as RpcResponse;
    if (unlocks.error !== null) {
      throw new Error(`loadAccount unlocks failed: ${unlocks.error.message}`);
    }

    return {
      userId,
      balances: toBalances(balances.data),
      unlockIds: Array.isArray(unlocks.data)
        ? unlocks.data.flatMap((row: unknown) =>
            isRecord(row) && typeof row["unlock_id"] === "string" ? [row["unlock_id"]] : [],
          )
        : [],
    };
  }

  async reserveSecureItem(
    reservationKey: string,
    matchId: string,
    userId: string,
    itemId: string,
  ): Promise<ReservationResult> {
    // `rpc` throws on failure rather than returning one, which is the contract's
    // second guarantee (`store.ts`): a caller may report the secure action
    // successful only when this *resolves*, so a failure must not be able to
    // look like a success behind a flag the caller might forget to check.
    const data = await this.rpc("reserve_secure_item", {
      p_reservation_key: reservationKey,
      p_match_id: matchId,
      p_user_id: userId,
      p_item_id: itemId,
    });
    const status = data["status"];
    return {
      reservationKey,
      itemId: typeof data["item_id"] === "string" ? data["item_id"] : itemId,
      status: status === "settled" || status === "cancelled" ? status : "pending",
      alreadyReserved: data["already_reserved"] === true,
    };
  }

  async cancelSecureReservation(reservationKey: string): Promise<boolean> {
    const response = (await this.client.rpc("cancel_secure_reservation", {
      p_reservation_key: reservationKey,
    })) as RpcResponse;
    if (response.error !== null) {
      throw new Error(`cancel_secure_reservation failed: ${response.error.message}`);
    }
    return response.data === true;
  }

  async settleRun(request: SettlementRequest): Promise<SettlementResult> {
    const data = await this.rpc("settle_match_reward", {
      p_settlement_key: request.settlementKey,
      p_match_id: request.matchId,
      p_user_id: request.userId,
      p_outcome: request.outcome,
      p_reward_payload: request.payload,
      p_points: request.points,
      p_unlocks: toUnlockPayload(request.unlocks),
      p_started_at: request.startedAt.toISOString(),
      p_ended_at: request.endedAt.toISOString(),
    });
    return {
      alreadySettled: data["already_settled"] === true,
      balances: toBalances(data["balances"]),
      unlockIds: toStringArray(data["unlock_ids"]),
    };
  }

  async listPendingReservations(
    userId: string,
    excludeMatchId: string | null,
  ): Promise<readonly PendingReservation[]> {
    const response = (await this.client.rpc("list_pending_reservations", {
      p_user_id: userId,
      p_exclude_match_id: excludeMatchId,
    })) as RpcResponse;
    if (response.error !== null) {
      throw new Error(`list_pending_reservations failed: ${response.error.message}`);
    }
    const { data } = response;
    if (!Array.isArray(data)) {
      return [];
    }
    return data.flatMap((entry: unknown) => {
      if (!isRecord(entry)) {
        return [];
      }
      const { reservation_key: key, match_id: matchId, item_id: itemId } = entry;
      if (typeof key !== "string" || typeof matchId !== "string" || typeof itemId !== "string") {
        return [];
      }
      return [{ reservationKey: key, matchId, userId, itemId }];
    });
  }

  close(): Promise<void> {
    // The Supabase client is stateless HTTP; there is no pool to drain. Present
    // so the interface has one shutdown path rather than two shapes.
    return Promise.resolve();
  }
}
