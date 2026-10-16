import { describe, expect, it, vi } from "vitest";
import { isJa11Device, markDeviceLost, quietLossReport } from "./deviceOperations";

describe("JA11 quiet recovery", () => {
  it("recognizes only the JA11", () => {
    expect(isJa11Device({ vendor_id: 0x2972, product_id: 0x0102 })).toBe(true);
    expect(isJa11Device({ vendor_id: 0x2972, product_id: 0x0101 })).toBe(true);
    expect(isJa11Device({ vendor_id: 0x2972, product_id: 0x0104 })).toBe(false);
    expect(isJa11Device(undefined)).toBe(false);
  });

  it("turns a loss into an untoasted info status, keeping the cause for diagnostics", () => {
    const reportStatus = vi.fn();
    const actions = { setConnected: vi.fn(), setIsReconnecting: vi.fn(), setLastPushedPeq: vi.fn(),
      setFirmwareVersion: vi.fn(), reportStatus: (status: Parameters<typeof reportStatus>[0]) => reportStatus(quietLossReport(status)) };
    markDeviceLost(actions, "Lost connection to device", "Device");
    expect(actions.setConnected).toHaveBeenCalledWith(false);
    expect(reportStatus).toHaveBeenCalledWith(expect.objectContaining({
      level: "Info", toastType: null, statusText: "Reconnecting…",
      message: "Recovering quietly: Lost connection to device",
    }));
    expect(JSON.stringify(reportStatus.mock.calls)).not.toContain('"toastType":"error"');
  });
});
