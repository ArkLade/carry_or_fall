/**
 * `docs/DECISIONS.md` is referenced by number from everywhere, and nothing
 * checked that the numbers resolved (M6.9, `docs/M6_ISSUES.md` §10).
 *
 * This is not hypothetical. Commit `847fe83` ("docs: record D28") rewrote the
 * tail of that file instead of appending to it and silently deleted D26 and
 * D27, while **more than twenty passages across seven documents** went on
 * citing D27. The deletion survived two milestones and was found by reading, not
 * by tooling; D26's own "Restored" note records the whole incident. Every gate
 * in this repository passed the entire time.
 *
 * Three properties, each of which would have caught it:
 *
 * 1. Every `D<n>` cited anywhere under `docs/` has a `## D<n>.` heading.
 * 2. No heading is duplicated — two entries under one number means one of them
 *    is being cited by accident.
 * 3. The headings run `1..N` with no gap. A gap is the fingerprint of a
 *    deletion, which is why append-only matters: superseding an entry is done
 *    **in place**, by marking it superseded (D26, D27), never by removing it.
 *    Every earlier document keeps pointing at something, and the record of what
 *    was once true survives.
 *
 * This test passes the day it is written. Its value is entirely prospective,
 * which is worth saying plainly so nobody reads a green run as evidence that
 * something was checked *this* time.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const docsDir = path.resolve(fileURLToPath(new URL("../../../docs", import.meta.url)));
const decisionsPath = path.join(docsDir, "DECISIONS.md");

/**
 * A decision heading: `## D42. Title`. The trailing period is required, which
 * is what keeps a line like `## D42 and D43 compared` from registering as two
 * entries.
 */
const HEADING_PATTERN = /^## D(\d+)\./gm;

/**
 * A citation: `D42`, but not `D-1` (M1's defect ids), not `3D`, and not a word
 * ending in D followed by digits.
 */
const CITATION_PATTERN = /(?<![A-Za-z0-9-])D(\d+)(?![0-9A-Za-z])/g;

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(full)));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function headingNumbers(source: string): number[] {
  return [...source.matchAll(HEADING_PATTERN)].map((match) => Number(match[1]));
}

describe("docs/DECISIONS.md integrity", () => {
  it("numbers its entries 1..N with no gap", async () => {
    const numbers = headingNumbers(await readFile(decisionsPath, "utf8"));
    expect(numbers.length).toBeGreaterThan(0);

    const expected = Array.from({ length: numbers.length }, (_, index) => index + 1);
    // Sorted, so an out-of-order entry is a separate failure from a missing one.
    expect([...numbers].sort((left, right) => left - right)).toEqual(expected);
  });

  it("has no duplicate entry number", async () => {
    const numbers = headingNumbers(await readFile(decisionsPath, "utf8"));
    const duplicates = numbers.filter((value, index) => numbers.indexOf(value) !== index);
    expect(duplicates).toEqual([]);
  });

  it("keeps entries in ascending order, so the file reads as a record", async () => {
    const numbers = headingNumbers(await readFile(decisionsPath, "utf8"));
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
  });

  it("resolves every D<n> cited anywhere under docs/", async () => {
    const decisions = new Set(headingNumbers(await readFile(decisionsPath, "utf8")));
    const dangling: string[] = [];

    for (const file of await markdownFiles(docsDir)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(CITATION_PATTERN)) {
        const number = Number(match[1]);
        if (!decisions.has(number)) {
          dangling.push(`${path.relative(docsDir, file)} cites D${String(number)}`);
        }
      }
    }

    // Named individually rather than counted: the useful failure message is
    // which document points at nothing.
    expect([...new Set(dangling)].sort()).toEqual([]);
  });

  it("recognizes a citation and a heading the way the two documents actually write them", () => {
    // The patterns above are the load-bearing part of this file, so they are
    // exercised directly rather than trusted. A pattern that matched nothing
    // would make every assertion above pass for the wrong reason.
    expect(headingNumbers("## D7. One match per Colyseus room\n## D42. Something\n")).toEqual([
      7, 42,
    ]);
    expect(headingNumbers("## D7 no trailing period\n### D8. wrong level\n")).toEqual([]);

    const cited = [...`see D8, D42's rule, and (D54).`.matchAll(CITATION_PATTERN)].map((match) =>
      Number(match[1]),
    );
    expect(cited).toEqual([8, 42, 54]);
    // M1's defect ids are `D-1`/`D-2` and are not decisions.
    expect([...`D-1 and D-2 were fixed`.matchAll(CITATION_PATTERN)]).toEqual([]);
  });
});
