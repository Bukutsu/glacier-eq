import { describe, expect, it } from "vitest";
import {
  asyncContextEquals,
  isHandledDeviceDisconnected,
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

describe("isHandledDeviceDisconnected", () => {
  const base = {
    payload: { path: "/dev/hidraw2", name: "Example DAC" } as const,
    activePath: "/dev/hidraw2",
    connected: true,
    manualDisconnect: false,
    devDummy: false,
    alreadyHandled: false,
  };

  it("suppresses the event during a manual disconnect close failure", () => {
    expect(isHandledDeviceDisconnected({ ...base, manualDisconnect: true })).toBe(true);
  });

  it("handles a genuine unplug while connected", () => {
    expect(isHandledDeviceDisconnected(base)).toBe(false);
  });

  it("suppresses stale, unconnected, dummy, and duplicate events", () => {
    expect(isHandledDeviceDisconnected({
      ...base,
      payload: { path: "/dev/hidraw3", name: "Other DAC" },
    })).toBe(true);
    expect(isHandledDeviceDisconnected({ ...base, payload: null })).toBe(true);
    expect(isHandledDeviceDisconnected({ ...base, connected: false })).toBe(true);
    expect(isHandledDeviceDisconnected({ ...base, devDummy: true })).toBe(true);
    expect(isHandledDeviceDisconnected({ ...base, alreadyHandled: true })).toBe(true);
  });
});
