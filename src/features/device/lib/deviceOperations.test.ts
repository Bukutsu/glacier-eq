import { describe, expect, it, vi } from "vitest";
import {
  isJa11Device,
  markDeviceLost,
  quietLossReport,
  resetEqOutcome,
  isJa11ReadTimeout,
  claimReadRecovery,
} from "./deviceOperations";

describe("read-only recovery", () => {
  it("recognizes only the observed silence errors, not generic failures", () => {
    expect(
      isJa11ReadTimeout("DAC is not responding. Unplug and replug the DAC"),
    ).toBe(true);
    expect(isJa11ReadTimeout(new Error("JA11 control read timeout"))).toBe(
      true,
    );
    for (const error of [
      "JA11 volume verification failed",
      "Invalid JA11 volume response",
      "Write failed",
      "permission denied",
    ]) {
      expect(isJa11ReadTimeout(error)).toBe(false);
    }
  });

  it("allows only one silent reopen, including across replacement sessions", () => {
    const budget = { silentUsed: false, inFlight: null as number | null };
    expect(claimReadRecovery(budget, 1, false, true)).toBe("reopen");
    expect(claimReadRecovery(budget, 1, false, true)).toBe("pending");
    budget.inFlight = null;
    expect(claimReadRecovery(budget, 2, false, true)).toBe("ignore");
    // A confirmed detach is different from another unanswered query.
    expect(claimReadRecovery(budget, 2, true, false)).toBe("reopen");
  });

  it("does not spend the recovery budget on unrelated failures", () => {
    const budget = { silentUsed: false, inFlight: null as number | null };
    expect(claimReadRecovery(budget, 1, false, false)).toBe("ignore");
    expect(budget).toEqual({ silentUsed: false, inFlight: null });
  });
});

describe("reset EQ outcome", () => {
  it("does not call a restarting DAC's skipped read-back an error", () => {
    expect(resetEqOutcome(true, undefined)).toEqual(
      expect.objectContaining({ type: "success" }),
    );
    expect(resetEqOutcome(true, false).type).toBe("success");
    expect(resetEqOutcome(true, undefined).message).toContain("restarting");
  });

  it("still reports a failed read-back on a DAC that does not restart", () => {
    expect(resetEqOutcome(false, false)).toEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(resetEqOutcome(false, true)).toEqual({
      message: "Device EQ reset to flat.",
      type: "success",
    });
    expect(resetEqOutcome(false, undefined).type).toBe("success");
  });
});

describe("JA11 quiet recovery", () => {
  it("recognizes only the JA11", () => {
    expect(isJa11Device({ controls: "ja11" })).toBe(true);
    expect(isJa11Device({ controls: "ja11" })).toBe(true);
    expect(isJa11Device({ controls: "dawn_pro" })).toBe(false);
    expect(isJa11Device(undefined)).toBe(false);
  });

  it("turns a loss into an untoasted info status, keeping the cause for diagnostics", () => {
    const reportStatus = vi.fn();
    const actions = {
      setConnected: vi.fn(),
      setIsReconnecting: vi.fn(),
      setLastPushedPeq: vi.fn(),
      setFirmwareVersion: vi.fn(),
      reportStatus: (status: Parameters<typeof reportStatus>[0]) =>
        reportStatus(quietLossReport(status)),
    };
    markDeviceLost(actions, "Lost connection to device", "Device");
    expect(actions.setConnected).toHaveBeenCalledWith(false);
    expect(reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "Info",
        toastType: null,
        statusText: "Reconnecting…",
        message: "Recovering quietly: Lost connection to device",
      }),
    );
    expect(JSON.stringify(reportStatus.mock.calls)).not.toContain(
      '"toastType":"error"',
    );
  });
});
