import type { PEQData } from "@/types";

import type {
  ReportLevel,
  ReportToast,
  ReportSource,
  ReportStatus,
} from "@/features/diagnostics/types";

/** State setters + reporter an device operation needs to signal a lost device. */
export interface DeviceLossActions {
  setConnected: (connected: boolean, path?: string | null) => void;
  setIsReconnecting: (value: boolean) => void;
  setLastPushedPeq: (peq: PEQData | null) => void;
  setFirmwareVersion: (version: string | null) => void;
  reportStatus: ReportStatus;
}

/** The JA11 restarts after a PEQ save or a setting write and comes back on its own. */
export const isJa11Device = (
  device?: { controls?: string | null } | null,
): boolean => device?.controls === "ja11";

export interface ReadRecoveryBudget {
  silentUsed: boolean;
  inFlight: number | null;
}

/** Claim before awaiting close, so concurrent failures cannot reopen twice. */
export function claimReadRecovery(
  budget: ReadRecoveryBudget,
  sessionId: number,
  disconnected: boolean,
  silent: boolean,
): "ignore" | "pending" | "reopen" {
  if (!disconnected && !silent) return "ignore";
  if (budget.inFlight === sessionId) return "pending";
  if (silent && budget.silentUsed) return "ignore";
  if (silent) budget.silentUsed = true;
  budget.inFlight = sessionId;
  return "reopen";
}

/** Only silence from a read is eligible for one automatic handle reopen.
 * Do not treat malformed data, verification failures or write errors as silence.
 */
export function isJa11ReadTimeout(error: unknown): boolean {
  const message = String(error).replace(/^Error: /, "");
  return (
    message === "JA11 control read timeout" ||
    message === "DAC is not responding. Unplug and replug the DAC"
  );
}

/**
 * Report a JA11 drop as routine: logged, with no error toast. The original
 * message stays in diagnostics so a real fault can still be diagnosed.
 */
export function quietLossReport<
  T extends {
    level: ReportLevel;
    message: string;
    toastType?: ReportToast;
    statusText?: string;
  },
>(status: T): T {
  return {
    ...status,
    level: "Info",
    message: `Recovering quietly: ${status.message}`,
    toastType: null,
    statusText: "Reconnecting…",
  };
}

/**
 * What to tell the user after "Reset EQ". A DAC that restarts after saving (the
 * JA11) cannot be read back until it reconnects, so a failed immediate read is
 * not an error there; the reconnect reloads the EQ.
 */
export function resetEqOutcome(
  restarts: boolean,
  pulled: boolean | void,
): { message: string; type: "success" | "error" } {
  if (restarts) {
    return {
      message:
        "Device EQ reset to flat. The DAC is restarting; its EQ reloads when it reconnects.",
      type: "success",
    };
  }
  return pulled === false
    ? {
        message:
          "Device EQ was reset, but reading it back failed. Read EQ from the DAC again before editing.",
        type: "error",
      }
    : { message: "Device EQ reset to flat.", type: "success" };
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
