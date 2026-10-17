import { describe, expect, it, vi } from "vitest";
import { createDeviceMaintenanceRunner } from "./runDeviceMaintenance";
import { operationFixture } from "./operationFixture.test-support";

describe("utility maintenance reservation", () => {
  it("claims synchronously and holds the shared slot while confirmation is open", async () => {
    const t = operationFixture();
    const run = createDeviceMaintenanceRunner(t);
    let finish!: () => void;
    const task = vi.fn(async (isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(true);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = run(task);
    expect(t.eqOperationInFlightRef.current).toBe(true);
    expect(t.setMaintenancePending).toHaveBeenLastCalledWith(true);
    await run(task);
    expect(task).toHaveBeenCalledOnce();
    finish();
    await first;
    expect(t.eqOperationInFlightRef.current).toBe(false);
    expect(t.setMaintenancePending).toHaveBeenLastCalledWith(false);
  });
  it.each(["path", "session", "generation", "disconnect"] as const)(
    "invalidates a pending confirmation on %s changes",
    async (change) => {
      const t = operationFixture();
      const write = vi.fn();
      await createDeviceMaintenanceRunner(t)(async (isCurrent) => {
        await Promise.resolve();
        if (change === "path") t.connectedPathRef.current = "/other";
        if (change === "session") t.connectedSessionIdRef.current = 2;
        if (change === "generation") t.connectionGenerationRef.current++;
        if (change === "disconnect") t.connectedRef.current = false;
        expect(isCurrent()).toBe(false);
        if (isCurrent()) write();
      });
      expect(write).not.toHaveBeenCalled();
      expect(t.eqOperationInFlightRef.current).toBe(false);
    },
  );
  it("releases the reservation after task failure", async () => {
    const t = operationFixture();
    await expect(
      createDeviceMaintenanceRunner(t)(async () => {
        throw new Error("transport failed");
      }),
    ).rejects.toThrow("transport failed");
    expect(t.eqOperationInFlightRef.current).toBe(false);
    expect(t.setMaintenancePending).toHaveBeenLastCalledWith(false);
  });
  it("does not clear an operation that superseded it", async () => {
    const t = operationFixture();
    await createDeviceMaintenanceRunner(t)(async () => {
      t.eqOperationIdRef.current++;
    });
    expect(t.eqOperationInFlightRef.current).toBe(true);
    expect(t.setMaintenancePending).toHaveBeenLastCalledWith(true);
  });
  it.each(["busy", "offline", "locked"] as const)(
    "rejects %s work",
    async (state) => {
      const t = operationFixture();
      if (state === "busy") t.isBusy = true;
      if (state === "offline") t.connectedRef.current = false;
      if (state === "locked") t.eqOperationInFlightRef.current = true;
      const task = vi.fn();
      await createDeviceMaintenanceRunner(t)(task);
      expect(task).not.toHaveBeenCalled();
    },
  );
});
