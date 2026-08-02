/**
 * A reporter that refuses to let an incomplete run look like a passing one
 * (`docs/DECISIONS.md` D54).
 *
 * When a Vitest worker dies natively — a crashed fork, not a failed assertion —
 * the file it was running never reports. Vitest's own summary then reads
 *
 *     Test Files  12 passed (13)
 *          Tests  148 passed (151)
 *
 * which is true and useless: every line says "passed", the counts in parentheses
 * are the only evidence anything is missing, and the file that vanished is
 * exactly the one nobody looked at. `apps/server/test/match-authority.test.ts`
 * and `apps/server/test/settlement-adversarial.test.ts` carry M4's and M5's
 * adversarial exit criteria (technical plan §38), so a run that silently skips a
 * file can report success while proving nothing about the claims that matter
 * most.
 *
 * The exit code was already non-zero. This adds the sentence a human reads.
 */
import type { Reporter, SerializedError, TestModule } from "vitest/node";

/** A module that never produced a result: queued or still pending at the end. */
function neverReported(module: TestModule): boolean {
  const state = module.state();
  return state === "queued" || state === "pending";
}

export default class IncompleteRunReporter implements Reporter {
  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
  ): void {
    const missing = testModules.filter(neverReported);
    if (missing.length === 0 && unhandledErrors.length === 0) {
      return;
    }

    const lines = [
      "",
      "─".repeat(72),
      "  SUITE INCOMPLETE — this run did not prove what a passing run proves.",
      "",
    ];

    if (missing.length > 0) {
      lines.push(
        `  ${String(missing.length)} of ${String(testModules.length)} test files never reported a result:`,
      );
      for (const module of missing) {
        lines.push(`    - ${module.moduleId.replace(/\\/g, "/")}`);
      }
      lines.push(
        "",
        "  Their tests are missing from the counts above. Do not read the",
        '  "N passed" lines as a pass.',
        "",
      );
    }

    if (unhandledErrors.length > 0) {
      lines.push(`  ${String(unhandledErrors.length)} unhandled error(s) escaped the tests:`);
      for (const error of unhandledErrors) {
        // A `SerializedError` crossed a process boundary: `message` is the only
        // field guaranteed to have survived, and it can be absent.
        lines.push(`    - ${error.message ?? "(no message)"}`);
      }
      lines.push(
        "",
        "  A worker that exits without a JavaScript error is a native crash, not",
        "  a test failure. `docs/DECISIONS.md` D54 records the known one.",
        "",
      );
    }

    lines.push("─".repeat(72), "");
    process.stderr.write(lines.join("\n"));
    process.exitCode = 1;
  }
}
