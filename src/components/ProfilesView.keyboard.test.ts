import { describe, expect, it } from "vitest";
import { isProfileRowKeyboardTarget } from "./ProfilesView";

describe("profile row keyboard ownership", () => {
  it("ignores keyboard events from nested action buttons", () => {
    const row = new EventTarget();
    const nestedButton = new EventTarget();

    expect(isProfileRowKeyboardTarget(nestedButton, row)).toBe(false);
    expect(isProfileRowKeyboardTarget(row, row)).toBe(true);
  });
});
