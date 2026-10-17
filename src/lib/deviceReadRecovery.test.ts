import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { describe, expect, it, vi } from "vitest";
import { isDisconnectionError } from "./errors";
import { claimReadRecovery, isJa11ReadTimeout } from "../features/device/deviceOperations";

// Exercise the actual App handlers, following pushCompletion.test.ts.
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
async function compile(name: string, next: string) {
  const source = app.slice(app.indexOf("  const " + name + " = useCallback("), app.indexOf(next));
  return (await transformWithOxc(source, name + ".ts")).code;
}
const recovery = await compile("recoverDeviceRead", "  const pullEq = useCallback(");
const restart = await compile("handleExpectedDisconnect", "  const resetDeviceEq = useCallback(");
const silence = "DAC is not responding. Unplug and replug the DAC";

function setup() {
  const scope = {
    useCallback: (fn: unknown) => fn,
    manualDisconnectRef: { current: false }, connectedRef: { current: true },
    connectedPathRef: { current: "/ja11" }, connectedSessionIdRef: { current: 1 },
    connectionGenerationRef: { current: 1 }, quietReconnectRef: { current: true },
    readRecoveryRef: { current: { silentUsed: false, inFlight: null as number | null } },
    expectedRestartUntilRef: { current: 0 }, restartWaitIdRef: { current: 0 },
    isDevDummyDevice: (path: string) => path.startsWith("dev:"),
    isDisconnectionError, isJa11ReadTimeout, claimReadRecovery,
    invoke: vi.fn(async (..._args: any[]) => undefined),
    sleep: vi.fn(async (_ms: number) => {}),
    reportStatus: vi.fn(), reportLoss: vi.fn(), markDeviceLost: vi.fn(),
    setConnected: vi.fn(), setIsReconnecting: vi.fn(), setLastPushedPeq: vi.fn(),
    setFirmwareVersion: vi.fn(), setRestartPending: vi.fn(),
  };
  const bind = (code: string, name: string) =>
    new Function(...Object.keys(scope), code + "\nreturn " + name)(...Object.values(scope));
  return {
    scope,
    recover: bind(recovery, "recoverDeviceRead") as (path: string, error: unknown) => Promise<boolean>,
    restart: bind(restart, "handleExpectedDisconnect") as (restart?: boolean) => Promise<void>,
  };
}

describe("App read recovery", () => {
  it("closes the exact session once and requests reconnect without replaying commands", async () => {
    const t = setup();
    expect(await t.recover("/ja11", silence)).toBe(true);
    expect(t.scope.invoke).toHaveBeenCalledExactlyOnceWith("disconnect_device", {
      expectedPath: "/ja11", expectedSessionId: 1,
    });
    expect(t.scope.markDeviceLost).toHaveBeenCalledTimes(1);
    t.scope.connectedSessionIdRef.current = 2;
    expect(await t.recover("/ja11", silence)).toBe(false);
    expect(t.scope.invoke).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent failures while close is pending", async () => {
    const t = setup();
    let finish!: () => void;
    t.scope.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = t.recover("/ja11", silence);
    expect(await t.recover("/ja11", silence)).toBe(true);
    expect(t.scope.invoke).toHaveBeenCalledTimes(1);
    finish(); await first;
    expect(t.scope.markDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("recognizes the Windows error from message2 even after the silence budget was spent", async () => {
    const t = setup();
    t.scope.readRecoveryRef.current.silentUsed = true;
    expect(await t.recover("/ja11", "WriteFile: (0x0000048F) The device is not connected.")).toBe(true);
    expect(t.scope.markDeviceLost).toHaveBeenCalledTimes(1);
  });

  it.each(["permission denied", "Invalid JA11 volume response", "volume verification failed"])(
    "does not reopen for %s", async error => {
      const t = setup();
      expect(await t.recover("/ja11", error)).toBe(false);
      expect(t.scope.invoke).not.toHaveBeenCalled();
    },
  );

  it("does not treat silence on another DAC as a JA11 recovery", async () => {
    const t = setup(); t.scope.quietReconnectRef.current = false;
    expect(await t.recover("/ja11", silence)).toBe(false);
    expect(t.scope.invoke).not.toHaveBeenCalled();
  });

  it("cannot mark a replacement session disconnected after awaiting close", async () => {
    const t = setup();
    t.scope.invoke.mockImplementationOnce(async () => {
      t.scope.connectedSessionIdRef.current = 2;
      t.scope.connectionGenerationRef.current++;
    });
    expect(await t.recover("/ja11", silence)).toBe(true);
    expect(t.scope.markDeviceLost).not.toHaveBeenCalled();
  });

  it("reports a close failure instead of claiming recovery", async () => {
    const t = setup();
    t.scope.invoke.mockRejectedValueOnce(new Error("close failed"));
    expect(await t.recover("/ja11", silence)).toBe(false);
    expect(t.scope.markDeviceLost).not.toHaveBeenCalled();
  });
});

describe("App expected save restart", () => {
  it("blocks operations through the restart gap and retires the old handle even if polling missed detach", async () => {
    const t = setup();
    await t.restart(true);
    expect(t.scope.sleep).toHaveBeenCalledExactlyOnceWith(2200);
    expect(t.scope.setRestartPending.mock.calls).toEqual([[true], [false]]);
    expect(t.scope.invoke).toHaveBeenCalledExactlyOnceWith("disconnect_device", {
      expectedPath: "/ja11", expectedSessionId: 1,
    });
    expect(t.scope.markDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("does not retire a replacement connection", async () => {
    const t = setup();
    t.scope.sleep.mockImplementationOnce(async () => { t.scope.connectionGenerationRef.current++; });
    await t.restart(true);
    expect(t.scope.invoke).not.toHaveBeenCalled();
    expect(t.scope.markDeviceLost).not.toHaveBeenCalled();
    expect(t.scope.setRestartPending).toHaveBeenLastCalledWith(false);
  });

  it("does not force a restart for ordinary volume or microphone writes", async () => {
    const t = setup(); await t.restart();
    expect(t.scope.sleep).not.toHaveBeenCalled();
    expect(t.scope.invoke).not.toHaveBeenCalled();
    expect(t.scope.expectedRestartUntilRef.current).toBeGreaterThan(Date.now());
  });
});
