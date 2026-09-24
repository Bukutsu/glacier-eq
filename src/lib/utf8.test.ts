import { describe, expect, it } from "vitest";
import { decodeUtf8 } from "./utf8";

describe("decodeUtf8", () => {
  it("rejects malformed UTF-8 instead of inserting replacement characters", () => {
    expect(() => decodeUtf8(Uint8Array.from([0x23, 0xff]).buffer)).toThrow();
    expect(decodeUtf8(Uint8Array.from([0x68, 0x69]).buffer)).toBe("hi");
  });
});
