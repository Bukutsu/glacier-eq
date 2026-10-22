import { createPullEq } from "@/features/device/operations/pullEq";
import { operationFixture } from "@/features/device/operations/operationFixture.test-support";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "@/features/diagnostics/stores/debugStore";

const reachedRead = new Error("read started");
function setup() {
  const scope = {
    ...operationFixture(),
    dirty: true,
    confirmDialog: vi.fn(async () => false),
    // Stop at the read boundary, before invoking hardware.
    setProgress: vi.fn(() => {
      throw reachedRead;
    }),
  };
  const pull = createPullEq(scope);
  return { scope, pull };
}
afterEach(() => useDebugStore.getState().setAutoDiscardEq(false));

describe("device read lifecycle", () => {
  it("adopts a current read and its matching profile, then releases the operation", async () => {
    const context = operationFixture();
    const peq = context.peqRef.current;
    context.invoke.mockResolvedValueOnce(peq).mockResolvedValueOnce("Daily");
    expect(await createPullEq(context)()).toBe(true);
    expect(context.invoke).toHaveBeenCalledWith("get_eq_state");
    expect(context.setSelectedPreset).toHaveBeenCalledWith("Daily");
    expect(context.setDirty).toHaveBeenCalledWith(false);
    expect(context.pushToUndoStack).toHaveBeenCalledOnce();
    expect(context.eqOperationInFlightRef.current).toBe(false);
    expect(context.setIsBusy).toHaveBeenLastCalledWith(false);
  });

  it("keeps an unmatched read dirty but takes it as the clean baseline", async () => {
    const context = operationFixture();
    const peq = context.peqRef.current;
    context.invoke.mockResolvedValueOnce(peq).mockResolvedValueOnce(null);
    expect(await createPullEq(context)()).toBe(true);
    expect(context.setSelectedPreset).toHaveBeenCalledWith(
      "Pulled from device",
    );
    expect(context.setDirty).toHaveBeenCalledWith(true);
    expect(context.editorCleanPeqRef.current).toEqual(
      context.setPeq.mock.calls[0][0],
    );
  });

  it("discards a read completed after the device session was replaced", async () => {
    const context = operationFixture();
    let finish!: (value: unknown) => void;
    context.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createPullEq(context)();
    context.connectedSessionIdRef.current = 2;
    finish(context.peqRef.current);
    expect(await pending).toBe(false);
    expect(context.setPeq).not.toHaveBeenCalled();
    expect(context.pushToUndoStack).not.toHaveBeenCalled();
    expect(context.eqOperationInFlightRef.current).toBe(false);
  });

  it("does not read a replacement device after confirmation", async () => {
    const context = { ...operationFixture(), dirty: true };
    let confirm!: (value: boolean) => void;
    context.confirmDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = createPullEq(context)();
    context.connectedSessionIdRef.current = 2;
    confirm(true);
    expect(await pending).toBe(false);
    expect(context.invoke).not.toHaveBeenCalled();
  });

  it("hands a failed read to recovery once without retrying commands", async () => {
    const context = operationFixture();
    context.invoke.mockRejectedValueOnce(new Error("read failed"));
    context.recoverDeviceRead.mockResolvedValueOnce(true);
    expect(await createPullEq(context)()).toBe(false);
    expect(context.invoke).toHaveBeenCalledOnce();
    expect(context.recoverDeviceRead).toHaveBeenCalledOnce();
    expect(context.eqOperationInFlightRef.current).toBe(false);
  });
});

describe("reconnect read", () => {
  const changed = (context: ReturnType<typeof operationFixture>) => ({
    ...context.peqRef.current,
    global_gain: context.peqRef.current.global_gain - 1,
  });

  it("keeps unsaved edits without asking and records the DAC's EQ", async () => {
    const context = { ...operationFixture(), dirty: true };
    const dac = changed(context);
    context.invoke.mockResolvedValueOnce(dac);
    const pull = createPullEq(context);
    expect(await pull(true, undefined, undefined, true)).toBe(true);
    expect(context.confirmDialog).not.toHaveBeenCalled();
    expect(context.setPeq).not.toHaveBeenCalled();
    expect(context.pushToUndoStack).not.toHaveBeenCalled();
    expect(context.setLastPushedPeq).toHaveBeenLastCalledWith(dac);
    expect(context.eqOperationInFlightRef.current).toBe(false);
  });

  it("leaves a clean editor alone when the DAC still matches it", async () => {
    const context = operationFixture();
    context.invoke.mockResolvedValueOnce(context.peqRef.current);
    expect(await createPullEq(context)(true, undefined, undefined, true)).toBe(
      true,
    );
    expect(context.setPeq).not.toHaveBeenCalled();
    expect(context.setLastPushedPeq).toHaveBeenLastCalledWith(
      context.peqRef.current,
    );
  });

  it("loads a DAC EQ that changed elsewhere into a clean editor", async () => {
    const context = operationFixture();
    const dac = changed(context);
    context.invoke.mockResolvedValueOnce(dac).mockResolvedValueOnce(null);
    expect(await createPullEq(context)(true, undefined, undefined, true)).toBe(
      true,
    );
    expect(context.setPeq).toHaveBeenCalledWith(dac);
  });
});

describe("debug discard confirmation", () => {
  it("keeps the discard confirmation on by default", async () => {
    const t = setup();
    expect(await t.pull()).toBe(false);
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
    expect(t.scope.setProgress).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "bypasses only the read confirmation (afterConnect=%s)",
    async (afterConnect) => {
      useDebugStore.getState().setAutoDiscardEq(true);
      const t = setup();
      await expect(t.pull(afterConnect)).rejects.toBe(reachedRead);
      expect(t.scope.confirmDialog).not.toHaveBeenCalled();
      expect(t.scope.eqOperationInFlightRef.current).toBe(true);
    },
  );

  it("restores confirmation immediately when disabled", async () => {
    const t = setup();
    useDebugStore.getState().setAutoDiscardEq(true);
    useDebugStore.getState().setAutoDiscardEq(false);
    expect(await t.pull()).toBe(false);
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
  });
});
