import { createReadRecovery } from "@/features/device/operations/recoverDeviceRead";
import { createExpectedRestart } from "@/features/device/operations/handleExpectedDisconnect";
import { operationFixture } from "@/features/device/operations/operationFixture.test-support";

import { describe, expect, it } from "vitest";

const silence = "DAC is not responding. Unplug and replug the DAC";

function setup() {
  const scope = operationFixture();
  return {
    scope,
    recover: createReadRecovery(scope),
    restart: createExpectedRestart(scope),
  };
}

describe("device read recovery", () => {
  it("closes the exact session once and requests reconnect without replaying commands", async () => {
    const t = setup();
    expect(await t.recover("/ja11", silence)).toBe(true);
    expect(t.scope.invoke).toHaveBeenCalledExactlyOnceWith(
      "disconnect_device",
      {
        expectedPath: "/ja11",
        expectedSessionId: 1,
      },
    );
    expect(t.scope.setConnected).toHaveBeenCalledTimes(1);
    t.scope.connectedSessionIdRef.current = 2;
    expect(await t.recover("/ja11", silence)).toBe(false);
    expect(t.scope.invoke).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent failures while close is pending", async () => {
    const t = setup();
    let finish!: () => void;
    t.scope.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = t.recover("/ja11", silence);
    expect(await t.recover("/ja11", silence)).toBe(true);
    expect(t.scope.invoke).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(t.scope.setConnected).toHaveBeenCalledTimes(1);
  });

  it("recognizes the Windows error from message2 even after the silence budget was spent", async () => {
    const t = setup();
    t.scope.readRecoveryRef.current.silentUsed = true;
    expect(
      await t.recover(
        "/ja11",
        "WriteFile: (0x0000048F) The device is not connected.",
      ),
    ).toBe(true);
    expect(t.scope.setConnected).toHaveBeenCalledTimes(1);
  });

  it.each([
    "permission denied",
    "Invalid JA11 volume response",
    "volume verification failed",
  ])("does not reopen for %s", async (error) => {
    const t = setup();
    expect(await t.recover("/ja11", error)).toBe(false);
    expect(t.scope.invoke).not.toHaveBeenCalled();
  });

  it("does not treat silence on another DAC as a JA11 recovery", async () => {
    const t = setup();
    t.scope.quietReconnectRef.current = false;
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
    expect(t.scope.setConnected).not.toHaveBeenCalled();
  });

  it("reports a close failure instead of claiming recovery", async () => {
    const t = setup();
    t.scope.invoke.mockRejectedValueOnce(new Error("close failed"));
    expect(await t.recover("/ja11", silence)).toBe(false);
    expect(t.scope.setConnected).not.toHaveBeenCalled();
  });
});

describe("expected save restart", () => {
  it("blocks operations through the restart gap and retires the old handle even if polling missed detach", async () => {
    const t = setup();
    await t.restart(true);
    expect(t.scope.sleep).toHaveBeenCalledExactlyOnceWith(2200);
    expect(t.scope.setRestartPending.mock.calls).toEqual([[true], [false]]);
    expect(t.scope.invoke).toHaveBeenCalledExactlyOnceWith(
      "disconnect_device",
      {
        expectedPath: "/ja11",
        expectedSessionId: 1,
      },
    );
    expect(t.scope.setConnected).toHaveBeenCalledTimes(1);
  });

  it("does not retire a replacement connection", async () => {
    const t = setup();
    t.scope.sleep.mockImplementationOnce(async () => {
      t.scope.connectionGenerationRef.current++;
    });
    await t.restart(true);
    expect(t.scope.invoke).not.toHaveBeenCalled();
    expect(t.scope.setConnected).not.toHaveBeenCalled();
    expect(t.scope.setRestartPending).toHaveBeenLastCalledWith(false);
  });

  it("does not force a restart for ordinary volume or microphone writes", async () => {
    const t = setup();
    await t.restart();
    expect(t.scope.sleep).not.toHaveBeenCalled();
    expect(t.scope.invoke).not.toHaveBeenCalled();
    expect(t.scope.expectedRestartUntilRef.current).toBeGreaterThan(Date.now());
  });
});
