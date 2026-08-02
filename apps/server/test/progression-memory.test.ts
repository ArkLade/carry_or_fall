/**
 * The contract suite against `MemoryStore` — the run CI performs
 * (`docs/M5_ISSUES.md` §1.5).
 *
 * What this proves: the server's persistence contract is coherent and the
 * calling code uses it correctly. What it does **not** prove: that the SQL in
 * `supabase/migrations/` implements the same contract. `pnpm test:supabase` runs
 * these identical assertions against real PostgreSQL, and the two claims are
 * reported separately (`docs/DATA_MODEL.md` §9).
 */
import { randomUUID } from "node:crypto";

import { MemoryStore } from "../src/progression/memory-store";
import { describeProgressionContract, type StoreHarness } from "./progression-contract";

describeProgressionContract("MemoryStore", (): Promise<StoreHarness> => {
  const store = new MemoryStore();
  return Promise.resolve({
    store,
    userId: `user-${randomUUID()}`,
    otherUserId: `user-${randomUUID()}`,
    newMatchId: () => randomUUID(),
    cleanup: () => store.close(),
  });
});
