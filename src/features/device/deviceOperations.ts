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
  reportStatus: (status: {
    level: ReportLevel;
    message: string;
    toastType?: ReportToast;
    source?: ReportSource;
    statusText?: string;
  }) => void;
}

/** The JA11 restarts after a PEQ save or a setting write and comes back on its own. */
export const isJa11Device = (device?: { vendor_id: number; product_id: number } | null): boolean =>
  !!device && device.vendor_id === 0x2972 && (device.product_id === 0x0101 || device.product_id === 0x0102);

/**
 * Report a JA11 drop as routine: logged, with no error toast. The original
 * message stays in diagnostics so a real fault can still be diagnosed.
 */
export function quietLossReport<T extends { level: ReportLevel; message: string; toastType?: ReportToast; statusText?: string }>(status: T): T {
  return { ...status, level: "Info", message: `Recovering quietly: ${status.message}`, toastType: null, statusText: "Reconnecting…" };
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
  /** "Info" when the loss was expected, such as a DAC restarting to save. */
  level: ReportLevel = "Error",
): void {
  actions.setConnected(false);
  actions.setIsReconnecting(true);
  actions.setLastPushedPeq(null);
  actions.setFirmwareVersion(null);
  actions.reportStatus({
    level,
    message,
    toastType: level === "Error" ? "error" : null,
    source,
    statusText: "Reconnecting…",
  });
}
