import type { PEQData } from "../../types";

export type ReportLevel = "Info" | "Warn" | "Error";
export type ReportToast = "success" | "info" | "error" | null;
export type ReportSource = "UI" | "Worker" | "HID" | "AutoEQ" | "Device";

/** State setters + reporter an device operation needs to signal a lost device. */
export interface DeviceLossActions {
  setConnected: (connected: boolean, path?: string | null) => void;
  setIsReconnecting: (value: boolean) => void;
  setLastPushedPeq: (peq: PEQData | null) => void;
  setFirmwareVersion: (version: string | null) => void;
  reportStatus: (
    level: ReportLevel,
    message: string,
    toastType?: ReportToast,
    source?: ReportSource,
    statusText?: string,
  ) => void;
}

/**
 * Shared disconnect quartet + reconnect status. Every device-loss path
 * (event listener, HID poll, pull/push/apply failures) funnels through here
 * so the UI can never show a half-disconnected state.
 */
export function markDeviceLost(
  actions: DeviceLossActions,
  message: string,
  source: ReportSource = "Device",
): void {
  actions.setConnected(false);
  actions.setIsReconnecting(true);
  actions.setLastPushedPeq(null);
  actions.setFirmwareVersion(null);
  actions.reportStatus("Error", message, "error", source, "Reconnecting...");
}
