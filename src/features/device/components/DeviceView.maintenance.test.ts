import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceView } from "./DeviceView";
import { createDeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";
import { operationFixture } from "@/features/device/operations/operationFixture.test-support";
import type { CoalescingTaskScheduler } from "@/lib/serializedWrites";

const controlState = {
  supported: true,
  filter_mode: "FAST-LL",
  amp_mode_class_ab: true,
  high_gain_mode: false,
  mic_volume_db: 0,
  channel_balance: 0,
};
const boundary = vi.hoisted(() => ({
  stateIndex: 0,
  scheduler: undefined as CoalescingTaskScheduler<string> | undefined,
  actions: new Map<string, () => Promise<void>>(),
  invoke: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("react", async () => ({
  ...(await vi.importActual("react")),
  useState: (initial: unknown) => {
    const index = boundary.stateIndex++;
    const value =
      index === 0
        ? {
            supported: true,
            filter_mode: "FAST-LL",
            amp_mode_class_ab: true,
            high_gain_mode: false,
            mic_volume_db: 0,
            channel_balance: 0,
          }
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
    if (index === 1)
      boundary.scheduler = value as CoalescingTaskScheduler<string>;
    return [value, () => {}];
  },
}));
vi.mock("@/components/layout/ConfigurationLayout", () => ({
  ConfigurationLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  confirmDialog: boundary.confirm,
}));
vi.mock("@/lib/rpc", () => ({
  invokeForDevice: boundary.invoke,
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/components/ui/SettingsPrimitives", async () => ({
  ...(await vi.importActual("@/components/ui/SettingsPrimitives")),
  ActionRow: (props: { title: string; onAction: () => Promise<void> }) => {
    boundary.actions.set(props.title, props.onAction);
    return null;
  },
}));

function setup() {
  const context = operationFixture();
  const onPull = vi.fn(async () => true);
  renderToStaticMarkup(
    createElement(DeviceView, {
      connected: true,
      section: "maintenance",
      setStatus: context.setStatus,
      onPull,
      runMaintenance: createDeviceMaintenanceRunner(context),
    }),
  );
  return {
    context,
    onPull,
    reset: boundary.actions.get("Reset device controls")!,
    factory: boundary.actions.get("Factory reset")!,
  };
}
beforeEach(() => {
  boundary.stateIndex = 0;
  boundary.actions.clear();
  boundary.invoke.mockReset().mockResolvedValue(controlState);
  boundary.confirm.mockReset().mockResolvedValue(true);
});

describe("DeviceView utility reset wiring", () => {
  it("reserves before confirmation, writes once, and uses verified returned state", async () => {
    const t = setup();
    let confirm!: (value: boolean) => void;
    boundary.confirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const reset = t.reset();
    expect(t.context.eqOperationInFlightRef.current).toBe(true);
    await t.reset();
    expect(boundary.confirm).toHaveBeenCalledOnce();
    expect(boundary.invoke).not.toHaveBeenCalled();
    confirm(true);
    await reset;
    expect(boundary.invoke).toHaveBeenCalledExactlyOnceWith(
      undefined,
      "reset_device_controls",
      undefined,
    );
    expect(t.context.setStatus).toHaveBeenCalledWith(
      "Device controls reset to defaults.",
      "success",
    );
    expect(t.context.eqOperationInFlightRef.current).toBe(false);
  });
  it.each(["Reset device controls", "Factory reset"])(
    "does not write after %s confirmation outlives the session",
    async (action) => {
      const t = setup();
      boundary.confirm.mockImplementationOnce(async () => {
        t.context.connectedSessionIdRef.current = 2;
        return true;
      });
      await boundary.actions.get(action)!();
      expect(boundary.invoke).not.toHaveBeenCalled();
      expect(t.onPull).not.toHaveBeenCalled();
    },
  );
  it("checks the session again when a reset queued behind a write starts", async () => {
    const t = setup();
    let finish!: () => void;
    boundary.scheduler!.enqueue("prior-write", async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await Promise.resolve();
    const reset = t.reset();
    await Promise.resolve();
    t.context.connectionGenerationRef.current++;
    finish();
    await reset;
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(t.context.eqOperationInFlightRef.current).toBe(false);
  });

  it("releases the reservation when confirmation is cancelled", async () => {
    const t = setup();
    boundary.confirm.mockResolvedValueOnce(false);
    await t.reset();
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(t.context.eqOperationInFlightRef.current).toBe(false);
    expect(t.context.setMaintenancePending).toHaveBeenLastCalledWith(false);
  });

  it("does not announce success when verification fails", async () => {
    const t = setup();
    boundary.invoke.mockRejectedValueOnce(
      new Error("Control verification failed"),
    );
    await t.reset();
    expect(t.context.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Could not reset device controls"),
    );
    expect(t.context.setStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      "success",
    );
  });
  it("releases the slot before factory-reset EQ readback", async () => {
    const t = setup();
    boundary.invoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(controlState);
    t.onPull.mockImplementationOnce(async () => {
      expect(t.context.eqOperationInFlightRef.current).toBe(false);
      return true;
    });
    await t.factory();
    expect(boundary.invoke.mock.calls.map((call) => call[1])).toEqual([
      "execute_factory_reset",
      "get_dac_utility_state",
    ]);
    expect(t.onPull).toHaveBeenCalledOnce();
    expect(t.context.setStatus).toHaveBeenCalledWith(
      "Device restored to factory defaults.",
      "success",
    );
  });
});
