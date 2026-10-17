import { createResetDeviceEq } from "@/features/device/operations/resetDeviceEq";
import {
  operationFixture,
  mockInvokeForDevice,
} from "@/features/device/operations/operationFixture.test-support";

import { describe, expect, it } from "vitest";

function setup() {
  const scope = {
    ...operationFixture(),
    invokeForDevice: mockInvokeForDevice(true),
  };
  const reset = createResetDeviceEq(scope);
  return { scope, reset };
}
describe("Reset EQ lifecycle", () => {
  it("claims the operation before confirmation, rejecting repeated clicks", async () => {
    const t = setup();
    let confirm!: (answer: boolean) => void;
    t.scope.confirmDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const first = t.reset();
    await t.reset();
    await t.reset();
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
    expect(t.scope.invokeForDevice).not.toHaveBeenCalled();
    confirm(true);
    await first;
    expect(t.scope.invokeForDevice).toHaveBeenCalledExactlyOnceWith(
      "/ja11",
      "reset_device_eq",
    );
  });

  it("keeps progress and the operation lock through reset and restart", async () => {
    const t = setup();
    let finish!: (value: boolean) => void;
    t.scope.invokeForDevice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = t.reset();
    await Promise.resolve();
    expect(t.scope.eqOperationInFlightRef.current).toBe(true);
    expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(true);
    expect(t.scope.setProgress).toHaveBeenCalledWith({
      message: "Resetting device EQ…",
      percentage: 0,
    });
    await t.reset();
    expect(t.scope.invokeForDevice).toHaveBeenCalledOnce();
    finish(true);
    await first;
    expect(t.scope.handleExpectedDisconnect).toHaveBeenCalledExactlyOnceWith(
      true,
    );
    expect(t.scope.pullEq).not.toHaveBeenCalled();
    expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(false);
    expect(t.scope.eqOperationInFlightRef.current).toBe(false);
  });

  it("releases the lock on cancellation or failure", async () => {
    for (const fail of [false, true]) {
      const t = setup();
      if (fail)
        t.scope.invokeForDevice.mockRejectedValueOnce(
          new Error("write failed"),
        );
      else t.scope.confirmDialog.mockResolvedValueOnce(false);
      await t.reset();
      expect(t.scope.eqOperationInFlightRef.current).toBe(false);
      expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(false);
      expect(t.scope.setProgress).toHaveBeenLastCalledWith(null);
    }
  });

  it("reads back a non-restarting DAC after releasing the EQ operation slot", async () => {
    const t = setup();
    t.scope.invokeForDevice.mockResolvedValueOnce(false);
    t.scope.pullEq.mockImplementationOnce(async () => {
      expect(t.scope.eqOperationInFlightRef.current).toBe(false);
      return true;
    });
    await t.reset();
    expect(t.scope.pullEq).toHaveBeenCalledOnce();
    expect(t.scope.handleExpectedDisconnect).not.toHaveBeenCalled();
  });

  it("cancels after confirmation if the connection was replaced", async () => {
    const t = setup();
    t.scope.confirmDialog.mockImplementationOnce(async () => {
      t.scope.connectionGenerationRef.current++;
      return true;
    });
    await t.reset();
    expect(t.scope.invokeForDevice).not.toHaveBeenCalled();
  });
});
