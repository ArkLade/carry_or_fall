import { describe, expect, it } from "vitest";

import { chaser } from "./enemies";

describe("chaser", () => {
  it("satisfies the shared enemy shape", () => {
    expect(chaser.kind).toBe("enemy");
    expect(chaser.id.length).toBeGreaterThan(0);
    expect(chaser.behavior).toBe("chaser");
  });

  it("has positive stats (a zero/negative value would mean an unkillable, immobile, or harmless enemy)", () => {
    expect(chaser.health).toBeGreaterThan(0);
    expect(chaser.moveSpeed).toBeGreaterThan(0);
    expect(chaser.contactDamage).toBeGreaterThan(0);
  });
});
