import { describe, expect, it } from "vitest";
import {
  asyncContextEquals,
  parseDeviceDisconnectedPayload,
} from "./asyncContext";

describe("asyncContextEquals", () => {
  it("requires both editor and connection revisions to match", () => {
    const context = { editorRevision: 3, connectionRevision: 7 };

    expect(asyncContextEquals(context, { ...context })).toBe(true);
    expect(asyncContextEquals(context, { ...context, editorRevision: 4 })).toBe(false);
    expect(asyncContextEquals(context, { ...context, connectionRevision: 8 })).toBe(false);
  });
});

describe("parseDeviceDisconnectedPayload", () => {
  it("accepts a structured path and display name", () => {
    expect(parseDeviceDisconnectedPayload(
      { path: "/dev/hidraw2", name: "Example DAC" },
      "/dev/hidraw2",
    )).toEqual({ path: "/dev/hidraw2", name: "Example DAC" });
  });

  it("accepts a legacy string only when it equals the active path", () => {
    expect(parseDeviceDisconnectedPayload("/dev/hidraw2", "/dev/hidraw2"))
      .toEqual({ path: "/dev/hidraw2", name: "/dev/hidraw2" });
    expect(parseDeviceDisconnectedPayload("Example DAC", "/dev/hidraw2")).toBeNull();
    expect(parseDeviceDisconnectedPayload("/dev/hidraw2", "/dev/hidraw3")).toBeNull();
  });

  it("rejects malformed structured payloads", () => {
    expect(parseDeviceDisconnectedPayload({ name: "Example DAC" }, "/dev/hidraw2"))
      .toBeNull();
    expect(parseDeviceDisconnectedPayload({ path: "/dev/hidraw2" }, "/dev/hidraw2"))
      .toBeNull();
  });
});
