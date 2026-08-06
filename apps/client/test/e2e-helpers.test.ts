import { describe, expect, it } from "vitest";

import * as e2eHelpers from "../e2e/helpers";
import { movementKeyToward, worldToPageCoordinates } from "../e2e/helpers";

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

describe("browser camera coordinates", () => {
  it("applies camera scroll before canvas offset and FIT scaling", () => {
    expect(
      worldToPageCoordinates(
        1160,
        640,
        {
          scrollX: 200,
          scrollY: 100,
          viewportWidth: 1920,
          viewportHeight: 1080,
        },
        { x: 40, y: 30, width: 960, height: 540 },
      ),
    ).toEqual({ x: 520, y: 300 });
  });

  it("does not mutate authoritative world positions while transforming them", () => {
    const authoritativePosition = Object.freeze({ x: 420, y: 180 });
    const camera = Object.freeze({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
    });

    worldToPageCoordinates(
      authoritativePosition.x,
      authoritativePosition.y,
      camera,
      Object.freeze({ x: 0, y: 0, width: 1920, height: 1080 }),
    );

    expect(authoritativePosition).toEqual({ x: 420, y: 180 });
    expect(camera.scrollX).toBe(0);
    expect(camera.scrollY).toBe(0);
  });
});

describe("removed duration-based helpers", () => {
  it.each(["moveFor", "meleeAttackFor", "rangedAttackFor"])("does not export %s", (name) => {
    expect(e2eHelpers).not.toHaveProperty(name);
  });
});
