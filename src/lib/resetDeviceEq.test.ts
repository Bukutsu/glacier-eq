import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { describe, expect, it, vi } from "vitest";
import { resetEqOutcome } from "../features/device/deviceOperations";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const source = app.slice(app.indexOf("  const resetDeviceEq = useCallback("), app.indexOf("  const handlePreviewChange = useCallback("));
const { code } = await transformWithOxc(source, "resetDeviceEq.ts");
function setup() {
  const scope = {
    useCallback: (fn: unknown) => fn, isBusy: false,
    eqOperationInFlightRef: { current: false }, eqOperationIdRef: { current: 0 },
    connectedRef: { current: true }, connectedPathRef: { current: "/ja11" },
    connectedSessionIdRef: { current: 1 }, connectionGenerationRef: { current: 1 },
    setMaintenancePending: vi.fn(), setProgress: vi.fn(), setStatus: vi.fn(),
    confirmDialog: vi.fn(async () => true),
    invokeForDevice: vi.fn(async () => true),
    handleExpectedDisconnect: vi.fn(async (_restart: boolean) => {}),
    recoverDeviceRead: vi.fn(async () => false),
    pullEq: vi.fn(async () => true), resetEqOutcome,
  };
  const reset = new Function(...Object.keys(scope), code + "\nreturn resetDeviceEq;")(...Object.values(scope)) as () => Promise<void>;
  return { scope, reset };
}
describe("Reset EQ lifecycle", () => {
  it("claims the operation before confirmation, rejecting repeated clicks", async () => {
    const t = setup();
    let confirm!: (answer: boolean) => void;
    t.scope.confirmDialog.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    const first = t.reset();
    await t.reset(); await t.reset();
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
    expect(t.scope.invokeForDevice).not.toHaveBeenCalled();
    confirm(true); await first;
    expect(t.scope.invokeForDevice).toHaveBeenCalledExactlyOnceWith("/ja11", "reset_device_eq");
  });

  it("keeps progress and the operation lock through reset and restart", async () => {
    const t = setup();
    let finish!: (value: boolean) => void;
    t.scope.invokeForDevice.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = t.reset();
    await Promise.resolve();
    expect(t.scope.eqOperationInFlightRef.current).toBe(true);
    expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(true);
    expect(t.scope.setProgress).toHaveBeenCalledWith({ message: "Resetting device EQ…", percentage: 0 });
    await t.reset();
    expect(t.scope.invokeForDevice).toHaveBeenCalledOnce();
    finish(true); await first;
    expect(t.scope.handleExpectedDisconnect).toHaveBeenCalledExactlyOnceWith(true);
    expect(t.scope.pullEq).not.toHaveBeenCalled();
    expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(false);
    expect(t.scope.eqOperationInFlightRef.current).toBe(false);
  });

  it("releases the lock on cancellation or failure", async () => {
    for (const fail of [false, true]) {
      const t = setup();
      if (fail) t.scope.invokeForDevice.mockRejectedValueOnce(new Error("write failed"));
      else t.scope.confirmDialog.mockResolvedValueOnce(false);
      await t.reset();
      expect(t.scope.eqOperationInFlightRef.current).toBe(false);
      expect(t.scope.setMaintenancePending).toHaveBeenLastCalledWith(false);
      expect(t.scope.setProgress).toHaveBeenLastCalledWith(null);
    }
  });

  it("reads back a non-restarting DAC after releasing the EQ operation slot", async () => {
    const t = setup(); t.scope.invokeForDevice.mockResolvedValueOnce(false);
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
      t.scope.connectionGenerationRef.current++; return true;
    });
    await t.reset();
    expect(t.scope.invokeForDevice).not.toHaveBeenCalled();
  });
});
