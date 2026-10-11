import { describe, expect, it } from "vitest";
import { keyboardViewportHeight } from "./useAndroidKeyboardViewport";

describe("Android keyboard viewport", () => {
  it("uses the visible height when WebView's layout viewport does not resize", () => {
    expect(keyboardViewportHeight(914, 577.9, 1)).toBe(578);
  });
  it("does not shrink a viewport which already resized for the keyboard", () => {
    expect(keyboardViewportHeight(578, 578, 1)).toBeNull();
  });
  it("ignores pinch zoom and small system-bar changes", () => {
    expect(keyboardViewportHeight(914, 578, 1.5)).toBeNull();
    expect(keyboardViewportHeight(914, 870, 1)).toBeNull();
  });
  it("clears the keyboard layout after dismissal or rotation", () => {
    expect(keyboardViewportHeight(914, 914, 1)).toBeNull();
    expect(keyboardViewportHeight(411, 411, 1)).toBeNull();
  });
});
