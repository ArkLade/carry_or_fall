import { describe, expect, it } from "vitest";

import { movementKeyToward } from "../e2e/helpers";

describe("browser walker steering", () => {
  it("advances only the dominant axis toward a non-45-degree target", () => {
    expect(movementKeyToward(140, 70)).toBe("KeyD");
    expect(movementKeyToward(-140, 70)).toBe("KeyA");
    expect(movementKeyToward(70, 140)).toBe("KeyS");
    expect(movementKeyToward(70, -140)).toBe("KeyW");
  });

  it("finishes the smaller axis after the dominant axis reaches its deadzone", () => {
    expect(movementKeyToward(8, 70)).toBe("KeyS");
    expect(movementKeyToward(8, 8)).toBeNull();
  });
});
