import { i18n } from "@/lib/i18n";
import type { invoke } from "@/lib/rpc";

import { isDevDummyDevice } from "@/features/device/lib/devDevice";

import { isDisconnectionError } from "@/lib/errors";

import {
  markDeviceLost,
  isJa11ReadTimeout,
  claimReadRecovery,
} from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";

import type { ReportStatus } from "@/features/diagnostics/types";

export type ReadRecoveryContext = Pick<
  DeviceState,
  | "manualDisconnectRef"
  | "quietReconnectRef"
  | "readRecoveryRef"
  | "connectedRef"
  | "connectedPathRef"
  | "connectedSessionIdRef"
  | "connectionGenerationRef"
  | "setConnected"
  | "setIsReconnecting"
  | "setFirmwareVersion"
  | "setLastPushedPeq"
> & {
  reportStatus: ReportStatus;
  reportLoss: ReportStatus;
  invoke: typeof invoke;
};

export function createReadRecovery(context: ReadRecoveryContext) {
  const {
    manualDisconnectRef,
    quietReconnectRef,
    readRecoveryRef,
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectionGenerationRef,
    setConnected,
    setIsReconnecting,
    setFirmwareVersion,
    setLastPushedPeq,
    reportStatus,
    reportLoss,
    invoke,
  } = context;
  return async (path: string, error: unknown): Promise<boolean> => {
    if (
      manualDisconnectRef.current ||
      !connectedRef.current ||
      connectedPathRef.current !== path ||
      isDevDummyDevice(path)
    )
      return false;
    const disconnected = isDisconnectionError(error);
    const silent = quietReconnectRef.current && isJa11ReadTimeout(error);
    const sessionId = connectedSessionIdRef.current;
    if (sessionId === null) return false;
    const claim = claimReadRecovery(
      readRecoveryRef.current,
      sessionId,
      disconnected,
      silent,
    );
    if (claim !== "reopen") return claim === "pending";
    const generation = connectionGenerationRef.current;
    reportStatus({
      level: "Info",
      source: "HID",
      message: `Closing device session ${sessionId} for ${disconnected ? "disconnect" : "one-shot silent-read recovery"}: ${error}`,
    });
    try {
      await invoke("disconnect_device", {
        expectedPath: path,
        expectedSessionId: sessionId,
      });
      if (
        manualDisconnectRef.current ||
        generation !== connectionGenerationRef.current ||
        connectedSessionIdRef.current !== sessionId
      )
        return true;
      markDeviceLost(
        {
          setConnected,
          setIsReconnecting,
          setLastPushedPeq,
          setFirmwareVersion,
          reportStatus: reportLoss,
        },
        i18n.t("device:recoverDeviceRead.reopeningDeviceAfterReadFailure", {
          error: error,
        }),
        "HID",
      );
      return true;
    } catch (closeError) {
      reportStatus({
        level: "Error",
        source: "HID",
        message: `Could not close device session ${sessionId}: ${closeError}`,
      });
      return false;
    } finally {
      if (readRecoveryRef.current.inFlight === sessionId)
        readRecoveryRef.current.inFlight = null;
    }
  };
}
