import { describe, expect, it, vi } from "vitest";
import { createConnectPrimary } from "./connectPrimary";
import { makeDeviceInfo } from "../lib/deviceFixtures.test-support";
import { DEV_DUMMY_DEVICE } from "../lib/devDevice";

const dac = makeDeviceInfo({ path: "/one" });
function setup(devices = [dac]) {
  const context = {
    canStart: vi.fn(() => true),
    setBusy: vi.fn(),
    pauseReconnect: vi.fn(),
    authorize: vi.fn(async () => {}),
    scan: vi.fn(async () => devices),
    connect: vi.fn(async () => true),
    showChooser: vi.fn(),
    reportError: vi.fn(),
  };
  return { context, run: createConnectPrimary(context) };
}

describe("primary DAC connection", () => {
  it("connects one real DAC directly, ignoring the development preview", async () => {
    const { context, run } = setup([dac, DEV_DUMMY_DEVICE]);
    await run();
    expect(context.connect).toHaveBeenCalledWith("/one", dac);
    expect(context.showChooser).not.toHaveBeenCalled();
    expect(context.pauseReconnect).toHaveBeenCalledOnce();
    expect(context.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it.each([[], [DEV_DUMMY_DEVICE], [dac, makeDeviceInfo({ path: "/two" })]])(
    "does not guess when there is no unique hardware DAC: %j",
    async (...devices) => {
      const { context, run } = setup(devices as (typeof dac)[]);
      await run();
      expect(context.connect).not.toHaveBeenCalled();
      expect(context.showChooser).toHaveBeenCalledOnce();
    },
  );

  it("keeps the chooser available after a failed connection", async () => {
    const { context, run } = setup();
    context.connect.mockResolvedValue(false);
    await run();
    expect(context.showChooser).toHaveBeenCalledOnce();
  });

  it("reports authorization failures and releases busy state", async () => {
    const { context, run } = setup();
    const error = new Error("Denied");
    context.authorize.mockRejectedValue(error);
    await run();
    expect(context.scan).not.toHaveBeenCalled();
    expect(context.reportError).toHaveBeenCalledWith(error);
    expect(context.showChooser).toHaveBeenCalledOnce();
    expect(context.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("rejects repeated taps while authorization is pending", async () => {
    const { context, run } = setup();
    let resolve!: () => void;
    context.authorize.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const first = run();
    await run();
    expect(context.authorize).toHaveBeenCalledOnce();
    resolve();
    await first;
    expect(context.connect).toHaveBeenCalledOnce();
  });

  it("does nothing while connected or another operation owns the device", async () => {
    const { context, run } = setup();
    context.canStart.mockReturnValue(false);
    await run();
    expect(context.authorize).not.toHaveBeenCalled();
    expect(context.scan).not.toHaveBeenCalled();
    expect(context.setBusy).not.toHaveBeenCalled();
  });
});
