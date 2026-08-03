/**
 * Architectural invariants M6 introduces, enforced rather than documented
 * (`docs/M6_ISSUES.md` §11.5).
 *
 * Two claims this milestone makes repeatedly, both of which are easy to state
 * and easy to erode:
 *
 * 1. **M6 adds no simulation rule.** Party membership changes no movement,
 *    collision, damage, loot, extraction, or reward rule, so
 *    `packages/simulation-core` should not know the word "party" at all. The
 *    day it does, something in a matchmaking milestone has started deciding
 *    gameplay.
 * 2. **Party membership is not public.** The marker list travels on the
 *    per-owner private message; the synchronized document every client receives
 *    has no party field, so there is no filtering rule to misconfigure
 *    (`docs/DECISIONS.md` D58). A field added to `MatchState` would silently
 *    broadcast who is grouped to everyone in the room.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const simulationSrc = path.join(repoRoot, "packages", "simulation-core", "src");
const matchStatePath = path.join(repoRoot, "apps", "server", "src", "rooms", "MatchState.ts");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Strip comments, so a module doc explaining what M6 did *not* do is not counted as doing it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("M6 adds no simulation rule", () => {
  it("simulation-core contains no party concept at all", async () => {
    const files = await sourceFiles(simulationSrc);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      if (/party/i.test(path.basename(file))) {
        offenders.push(path.relative(simulationSrc, file));
        continue;
      }
      if (/\bparty/i.test(withoutComments(await readFile(file, "utf8")))) {
        offenders.push(path.relative(simulationSrc, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("party membership is never in the public document", () => {
  it("the synchronized match schema declares no party field", async () => {
    const source = withoutComments(await readFile(matchStatePath, "utf8"));
    expect(/\bparty/i.test(source)).toBe(false);
  });

  it("the marker list exists on exactly two files, both on the private path", async () => {
    // `MatchRoom` scopes the list to the recipient's own party; `private-state`
    // puts it on the one message addressed to that recipient. Pinning the set
    // is the point rather than a nuisance: a third file mentioning it is either
    // a second producer — one of which will be the one that forgets to scope
    // the list — or a leak onto the public path, and both deserve a failing
    // test and a decision rather than a silent merge.
    const serverSrc = path.join(repoRoot, "apps", "server", "src");
    const producers: string[] = [];
    for (const file of await sourceFiles(serverSrc)) {
      if (withoutComments(await readFile(file, "utf8")).includes("partyMemberIds")) {
        producers.push(path.relative(serverSrc, file).replaceAll(path.sep, "/"));
      }
    }
    expect(producers.sort()).toEqual(["rooms/MatchRoom.ts", "rooms/private-state.ts"]);
    // Named explicitly, because these two are the public path: the reconciler
    // that builds the synchronized document, and the schema it builds it into.
    expect(producers).not.toContain("rooms/match-sync.ts");
    expect(producers).not.toContain("rooms/MatchState.ts");
  });
});
