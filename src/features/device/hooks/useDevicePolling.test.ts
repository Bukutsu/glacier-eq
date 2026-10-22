import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useDevicePolling } from "./useDevicePolling";
import type { DeviceState } from "./useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import { operationFixture } from "../operations/operationFixture.test-support";
import { makeDeviceInfo } from "../lib/deviceFixtures.test-support";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  attached: null as { path: string } | null,
  setAttached: vi.fn(),
  callback: null as null | ((payload: unknown) => void),
  unregister: vi.fn(async () => {}),
  invoke: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
  useState: () => [harness.attached, harness.setAttached],
}));
vi.mock("@/lib/platform", () => ({ isTauri: () => true }));
vi.mock("@/lib/rpc", () => ({
  invoke: (...args: unknown[]) => harness.invoke(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  addPluginListener: vi.fn(async (_plugin, _event, callback) => {
    harness.callback = callback;
    return { unregister: harness.unregister };
  }),
}));

function setup() {
  const base = operationFixture();
  base.connectedRef.current = false;
  base.manualDisconnectRef.current = true;
  const device = {
    ...base,
    connected: false,
    reconnectEffectGenerationRef: { current: 0 },
    ambiguousReconnectRef: { current: true },
    pullEqRef: { current: vi.fn(async () => true) },
    lastConnectedNameRef: { current: "Previous DAC" },
    selectedDeviceRef: { current: base.selectedDevice },
    connectingPathRef: { current: null as string | null },
    connectingSessionIdRef: { current: null as number | null },
    connectedDeviceName: "Previous DAC",
    setConnectedDeviceName: vi.fn(),
  };
  const firmware = vi.fn(async () => {});
  const options = {
    isAndroid: true,
    isMobile: true,
    settings: {
      auto_pull_on_connect: true,
      skip_push_verification: false,
      live_apply: false,
      theme: "system",
      snap_to_iso_frequencies: false,
      floating_graph_preview: true,
    },
    reportStatus: base.reportStatus,
    reportLoss: base.reportLoss,
    setStatus: base.setStatus,
    setShowDeviceModal: vi.fn(),
  };
  const render = () => {
    harness.effects = [];
    // Only the fields used by this hook are needed; all I/O is mocked.
    useDevicePolling(
      device as unknown as DeviceState,
      base as unknown as EqEditor,
      firmware,
      options,
    );
  };
  render();
  return { device, render };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.attached = null;
  harness.callback = null;
  harness.setAttached.mockImplementation((value) => {
    harness.attached = value;
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function subscribe() {
  const cleanup = harness.effects[1]();
  await vi.waitFor(() => expect(harness.callback).not.toBeNull());
  return cleanup;
}
describe("Android USB attach wake-up", () => {
  it("resumes discovery after manual disconnect and targets the approved device", async () => {
    const { device, render } = setup();
    const stop = await subscribe();
    harness.callback!({ path: "/attached" });
    expect(device.manualDisconnectRef.current).toBe(false);
    expect(device.ambiguousReconnectRef.current).toBe(false);
    render();
    harness.invoke.mockImplementation(async (command) =>
      command === "list_devices"
        ? [
            makeDeviceInfo({ path: "/other" }),
            makeDeviceInfo({ path: "/attached" }),
          ]
        : 2,
    );
    const cleanupPoll = harness.effects[3]();
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.invoke).toHaveBeenCalledWith("connect_device", {
      path: "/attached",
    });
    cleanupPoll?.();
    stop?.();
  });

  it("does not connect an unrelated DAC while waiting for the attached path", async () => {
    const { render } = setup();
    const stop = await subscribe();
    harness.callback!({ path: "/attached" });
    render();
    harness.invoke.mockResolvedValue([makeDeviceInfo({ path: "/other" })]);
    const cleanupPoll = harness.effects[3]();
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.invoke).not.toHaveBeenCalledWith(
      "connect_device",
      expect.anything(),
    );
    cleanupPoll?.();
    stop?.();
  });

  it("ignores malformed, connected, and already-connecting events", async () => {
    const { device } = setup();
    const stop = await subscribe();
    for (const payload of [null, {}, { path: 1 }, { path: "" }])
      harness.callback!(payload);
    device.connectedRef.current = true;
    harness.callback!({ path: "/attached" });
    device.connectedRef.current = false;
    device.connectingPathRef.current = "/pending";
    harness.callback!({ path: "/attached" });
    expect(harness.setAttached).not.toHaveBeenCalled();
    expect(device.manualDisconnectRef.current).toBe(true);
    stop?.();
  });

  it("unregisters on cleanup and ignores late events", async () => {
    setup();
    const stop = await subscribe();
    stop?.();
    harness.callback!({ path: "/attached" });
    expect(harness.unregister).toHaveBeenCalledOnce();
    expect(harness.setAttached).not.toHaveBeenCalled();
  });
});
