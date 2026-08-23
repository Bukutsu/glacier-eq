import { describe, expect, it } from "vitest";
import {
  isDisconnectionErrorForPlatform,
  isWindowsPlatform,
} from "./errors";

describe("isWindowsPlatform", () => {
  it.each(["Win32", "Windows", "win64"])("recognizes %s", (platform) => {
    expect(isWindowsPlatform(platform)).toBe(true);
  });

  it.each(["Linux x86_64", "MacIntel", "Android", ""])("rejects %s", (platform) => {
    expect(isWindowsPlatform(platform)).toBe(false);
  });
});

describe("isDisconnectionErrorForPlatform", () => {
  it("does not classify OS error 5 as a disconnect on Windows", () => {
    expect(isDisconnectionErrorForPlatform("device failed: os error 5", true)).toBe(false);
  });

  it("classifies OS error 5 as a disconnect off Windows", () => {
    expect(isDisconnectionErrorForPlatform("device failed: os error 5", false)).toBe(true);
  });

  it("keeps platform-independent disconnect classifications", () => {
    expect(isDisconnectionErrorForPlatform("No such device", true)).toBe(true);
    expect(isDisconnectionErrorForPlatform("No such device", false)).toBe(true);
  });
});
