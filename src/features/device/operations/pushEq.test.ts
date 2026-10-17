import { createPushEq } from "@/features/device/operations/pushEq";
import {
  operationFixture,
  mockInvoke,
} from "@/features/device/operations/operationFixture.test-support";

import { describe, expect, it, vi } from "vitest";

import type { DeviceCapabilities } from "@/types";
import { buildDefaultState } from "@/features/eq/lib/peq";

function setup() {
  const editor = buildDefaultState();
  editor.global_gain = -3.33;
  const committed = { ...editor, global_gain: -3.3 };
  let editorRevision = 0;
  const operationRevisionRef = { current: 0 };
  const connectionGenerationRef = { current: 1 };
  const connectedPathRef = { current: "/dev/test" };
  const connectedSessionIdRef = { current: 1 };
  const setPeq = vi.fn();
  const setLastPushedPeq = vi.fn();
  const reportStatus = vi.fn();
  const invoke = mockInvoke(committed);
  const sleep = vi.fn(async () => {});
  const scope = {
    ...operationFixture(),
    connected: true,
    selectedDevice: "/dev/test",
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
