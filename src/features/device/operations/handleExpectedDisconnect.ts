import type { invoke, sleep } from "@/lib/rpc";

import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";

import type { ReportStatus } from "@/features/diagnostics/types";

export type ExpectedRestartContext = Pick<
  DeviceState,
  | "manualDisconnectRef"
  | "expectedRestartUntilRef"
  | "connectedPathRef"
  | "connectedSessionIdRef"
  | "connectionGenerationRef"
  | "setConnected"
  | "setIsReconnecting"
  | "setFirmwareVersion"
  | "setRestartPending"
  | "restartWaitIdRef"
  | "setLastPushedPeq"
> & {
  reportStatus: ReportStatus;
  reportLoss: ReportStatus;
  invoke: typeof invoke;
  sleep: typeof sleep;
};

export function createExpectedRestart(context: ExpectedRestartContext) {
  const {
    manualDisconnectRef,
    expectedRestartUntilRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectionGenerationRef,
    setConnected,
    setIsReconnecting,
    setFirmwareVersion,
    setRestartPending,
    restartWaitIdRef,
    setLastPushedPeq,
    reportStatus,
    reportLoss,
    invoke,
    sleep,
  } = context;
  return async (restart = false) => {
    expectedRestartUntilRef.current = Date.now() + 15_000;
    if (!restart) return; // A control write may restart; Save is known to do so.
    const path = connectedPathRef.current;
    const sessionId = connectedSessionIdRef.current;
    const generation = connectionGenerationRef.current;
    if (!path || sessionId === null) return;
    const ticket = ++restartWaitIdRef.current;
    setRestartPending(true);
    try {
      // Tester traces show Save re-enumerating about 1.7–2 s later. Do not
      // issue queries in that gap. Then retire the old handle even if polling
      // missed the brief disappearance and Windows reused the same USB path.
      await sleep(2200);
      if (
        manualDisconnectRef.current ||
        generation !== connectionGenerationRef.current ||
        connectedSessionIdRef.current !== sessionId
      )
        return;
      await invoke("disconnect_device", {
        expectedPath: path,
        expectedSessionId: sessionId,
      });
      if (generation !== connectionGenerationRef.current) return;
      markDeviceLost(
        {
          setConnected,
          setIsReconnecting,
          setLastPushedPeq,
          setFirmwareVersion,
          reportStatus: reportLoss,
        },
        "DAC save completed; reopening after expected restart",
        "HID",
        "Info",
      );
    } catch (error) {
      reportStatus({
        level: "Error",
        source: "HID",
        message: `Could not retire restarting device session: ${error}`,
      });
    } finally {
      if (ticket === restartWaitIdRef.current) setRestartPending(false);
    }
  };
}
