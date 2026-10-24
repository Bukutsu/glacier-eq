import { createPushEq } from "@/features/device/operations/pushEq";
import { setMelodySlot } from "@/features/device/lib/melodySlot";
import {
  operationFixture,
  mockInvoke,
} from "@/features/device/operations/operationFixture.test-support";

import { describe, expect, it, vi } from "vitest";

import type { DeviceCapabilities, DeviceInfo } from "@/types";
import { buildDefaultState } from "@/features/eq/lib/peq";

function setup(path = "/dev/test") {
  const editor = buildDefaultState();
  editor.global_gain = -3.33;
  const committed = { ...editor, global_gain: -3.3 };
  let editorRevision = 0;
  const operationRevisionRef = { current: 0 };
  const connectionGenerationRef = { current: 1 };
  const connectedPathRef = { current: path };
  const connectedSessionIdRef = { current: 1 };
  const setPeq = vi.fn();
  const setLastPushedPeq = vi.fn();
  const reportStatus = vi.fn();
  const invoke = mockInvoke(committed);
  const sleep = vi.fn(async () => {});
  const scope = {
    ...operationFixture(),
    connected: true,
    selectedDevice: path,
    selectedDeviceInfo: {
      controls: "melody",
      profile_name: "SNOWSKY Melody",
      user_eq_slots: [160, 161, 162],
    } as DeviceInfo,
    selectedCapabilities: {
      num_bands: 10,
      global_gain_range: [-10, 10],
      band_gain_range: [-12, 12],
      freq_range: [20, 20000],
      q_range: [0.1, 10],
      supported_filter_types: ["Peak"],
      supports_per_band_enable: true,
      supports_ram_apply: false,
      dsp_sample_rate: 48000,
      integer_preamp: false,
    } satisfies DeviceCapabilities,
    isMobile: false,
    peqRef: { current: editor },
    operationRevisionRef,
    connectionGenerationRef,
    connectedPathRef,
    connectedSessionIdRef,
    eqOperationInFlightRef: { current: false },
    eqOperationIdRef: { current: 0 },
    manualDisconnectRef: { current: false },
    expectedRestartUntilRef: { current: 0 },
    handleExpectedDisconnect: vi.fn(async () => {}),
    recoverDeviceRead: vi.fn(async (_path: string, _error: unknown) => false),
    getAsyncContext: () => ({
      editorRevision,
      connectionRevision: connectionGenerationRef.current,
      operationRevision: operationRevisionRef.current,
    }),
    noteEditorMutation: () => {
      editorRevision++;
    },
    confirmDialog: vi.fn(async () => true),
    invoke,
    sleep,
    setPeq,
    setLastPushedPeq,
    reportStatus,
    setStatus: vi.fn(),
    setProgress: vi.fn(),
    setIsBusy: vi.fn(),
    pushToUndoStack: vi.fn(),
    setConnected: vi.fn(),
    setIsReconnecting: vi.fn(),
    setFirmwareVersion: vi.fn(),
  };
  const push = createPushEq(scope);
  return {
    scope,
    push,
    committed,
    editor,
    invoke,
    sleep,
    setPeq,
    setLastPushedPeq,
    reportStatus,
  };
}

describe("push completion", () => {
  it("sends the chosen Melody destination with the editor write", async () => {
    const t = setup("/melody-push");
    setMelodySlot("/melody-push", 162);
    await t.push();
    expect(t.invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ melody_slot: 162 }),
    );
  });

  it("reports a JA11 save restart without claiming post-restart verification", async () => {
    const t = setup();
    t.invoke.mockResolvedValue({
      ...t.committed,
      warnings: [],
      restarts: true,
    });
    await t.push();
    expect(t.scope.expectedRestartUntilRef.current).toBeGreaterThan(Date.now());
    expect(t.scope.handleExpectedDisconnect).toHaveBeenCalledExactlyOnceWith(
      true,
    );
    expect(t.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "Info",
        message: "Saved EQ to DAC; restart expected, waiting to reconnect",
      }),
    );
  });

  it("adopts rounded readback and records success despite its own editor revision change", async () => {
    const t = setup();
    await t.push();
    expect(t.setPeq).toHaveBeenCalledWith(t.committed);
    expect(t.setLastPushedPeq).toHaveBeenCalledWith(t.committed);
    expect(t.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ level: "Info", message: "Saved EQ to DAC" }),
    );
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.scope.eqOperationInFlightRef.current).toBe(false);
  });

  it("records a completed write without overwriting edits made while it ran", async () => {
    const t = setup();
    t.invoke.mockImplementation(async () => {
      t.scope.noteEditorMutation();
      return t.committed;
    });
    await t.push();
    expect(t.setPeq).not.toHaveBeenCalled();
    expect(t.setLastPushedPeq).toHaveBeenCalledWith(t.committed);
    expect(t.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ level: "Info" }),
    );
  });

  it.each(["connection", "path", "session", "operation"] as const)(
    "ignores a completion after the %s changes",
    async (change) => {
      const t = setup();
      t.invoke.mockImplementation(async () => {
        if (change === "connection") t.scope.connectionGenerationRef.current++;
        if (change === "path") t.scope.connectedPathRef.current = "/dev/other";
        if (change === "session") t.scope.connectedSessionIdRef.current++;
        if (change === "operation") t.scope.operationRevisionRef.current++;
        return t.committed;
      });
      await t.push();
      expect(t.setPeq).not.toHaveBeenCalled();
      expect(t.setLastPushedPeq).not.toHaveBeenCalled();
      expect(t.reportStatus).not.toHaveBeenCalled();
      expect(t.scope.expectedRestartUntilRef.current).toBe(0);
    },
  );

  it("reports write failures even when the editor changed during the write", async () => {
    const t = setup();
    t.invoke.mockImplementation(async () => {
      t.scope.noteEditorMutation();
      throw new Error("Push verification failed; previous state restored");
    });
    await t.push();
    expect(t.setLastPushedPeq).not.toHaveBeenCalled();
    expect(t.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ level: "Error" }),
    );
    expect(t.scope.eqOperationInFlightRef.current).toBe(false);
  });
});

describe("user-bank confirmation", () => {
  it("selects and saves a non-Melody FiiO bank by its protocol slot", async () => {
    const { scope, invoke } = setup("/btr13-picker");
    scope.selectedDeviceInfo = {
      controls: null,
      profile_name: "FIIO BTR13",
      user_eq_slots: [7, 8, 9],
    } as DeviceInfo;
    const chooseUserBank = vi.fn(async () => ({
      slot: 8,
      confirmed: true,
    }));
    await createPushEq({ ...scope, chooseUserBank })();
    expect(chooseUserBank).toHaveBeenCalledWith({
      path: "/btr13-picker",
      count: 0,
      preamp: "-3.33 dB",
      slots: [7, 8, 9],
      isMelody: false,
    });
    expect(invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ fiio_slot: 8 }),
    );
  });

  it("writes directly to an explicit User bank and confirms that target", async () => {
    const { scope, invoke } = setup("/melody-explicit-slot");
    const chooseUserBank = vi.fn(async () => ({
      slot: 160,
      confirmed: false,
    }));
    await createPushEq({ ...scope, chooseUserBank })({ melodySlot: 162 });
    expect(chooseUserBank).not.toHaveBeenCalled();
    expect(scope.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("User 3"),
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ melody_slot: 162 }),
    );
  });

  it("saves to the explicitly confirmed bank without a second generic confirmation", async () => {
    const { scope, invoke } = setup("/melody-picker");
    const chooseUserBank = vi.fn(async () => ({
      slot: 162,
      confirmed: true,
    }));
    await createPushEq({ ...scope, chooseUserBank })();
    expect(chooseUserBank).toHaveBeenCalledWith({
      path: "/melody-picker",
      count: 0,
      preamp: "-3.33 dB",
      slots: [160, 161, 162],
      isMelody: true,
    });
    expect(scope.confirmDialog).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ melody_slot: 162 }),
    );
  });

  it("confirms the active bank even when the caller selects it automatically", async () => {
    const { scope, invoke } = setup("/melody-active");
    await createPushEq({
      ...scope,
      chooseUserBank: async () => ({ slot: 160, confirmed: false }),
    })();
    expect(scope.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("User 1"),
        confirmLabel: expect.stringContaining("User 1"),
        message: expect.stringContaining("User 1"),
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ melody_slot: 160 }),
    );
  });

  it("does not select a bank or write when cancelled", async () => {
    const { scope, invoke } = setup("/melody-cancel");
    setMelodySlot("/melody-cancel", 160);
    await createPushEq({ ...scope, chooseUserBank: async () => null })();
    expect(invoke).not.toHaveBeenCalled();
    expect(scope.setIsBusy).not.toHaveBeenCalled();
  });

  it("rejects a bank confirmation from before reconnect", async () => {
    const { scope, invoke } = setup("/melody-reconnect");
    await createPushEq({
      ...scope,
      chooseUserBank: async () => {
        scope.connectionGenerationRef.current++;
        return { slot: 161, confirmed: true };
      },
    })();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the confirmed EQ snapshot even if the bank default changes later", async () => {
    const { scope, invoke } = setup("/melody-snapshot");
    scope.confirmDialog.mockImplementation(async () => {
      setMelodySlot("/melody-snapshot", 162);
      return true;
    });
    setMelodySlot("/melody-snapshot", 161);
    await createPushEq(scope)();
    expect(invoke).toHaveBeenCalledWith(
      "set_eq_state",
      expect.objectContaining({ melody_slot: 161 }),
    );
  });
});
