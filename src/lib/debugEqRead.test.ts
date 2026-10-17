import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "../stores/debugStore";
import { asyncContextEquals } from "./asyncContext";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const start = app.indexOf("  const pullEq = useCallback(");
const end = app.indexOf("  useEffect(() => {\n    pullEqRef.current = pullEq;", start);
const { code } = await transformWithOxc(app.slice(start, end), "pullEq.ts");
const reachedRead = new Error("read started");
function setup() {
  const scope = {
    useCallback: (fn: unknown) => fn, useDebugStore,
    connected: true, dirty: true, selectedDevice: "/ja11", selectedCapabilities: {},
    eqOperationInFlightRef: { current: false }, eqOperationIdRef: { current: 0 },
    operationRevisionRef: { current: 0 }, connectedPathRef: { current: "/ja11" },
    connectedSessionIdRef: { current: 1 }, connectionGenerationRef: { current: 1 },
    getAsyncContext: () => ({ editorRevision: 1, connectionRevision: 1, operationRevision: 1 }),
    asyncContextEquals, isDevDummyDevice: () => false,
    confirmDialog: vi.fn(async () => false),
    // Stop at the read boundary, before invoking hardware.
    setProgress: vi.fn(() => { throw reachedRead; }),
    pushToUndoStack: vi.fn(), reportStatus: vi.fn(), setStatus: vi.fn(),
    noteEditorMutation: vi.fn(), recoverDeviceRead: vi.fn(),
  };
  const pull = new Function(...Object.keys(scope), code + "\nreturn pullEq;")(...Object.values(scope)) as (afterConnect?: boolean) => Promise<boolean>;
  return { scope, pull };
}
afterEach(() => useDebugStore.getState().setAutoDiscardEq(false));

describe("debug discard confirmation", () => {
  it("keeps the discard confirmation on by default", async () => {
    const t = setup();
    expect(await t.pull()).toBe(false);
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
    expect(t.scope.setProgress).not.toHaveBeenCalled();
  });

  it.each([false, true])("bypasses only the read confirmation (afterConnect=%s)", async afterConnect => {
    useDebugStore.getState().setAutoDiscardEq(true);
    const t = setup();
    await expect(t.pull(afterConnect)).rejects.toBe(reachedRead);
    expect(t.scope.confirmDialog).not.toHaveBeenCalled();
    expect(t.scope.eqOperationInFlightRef.current).toBe(true);
  });

  it("restores confirmation immediately when disabled", async () => {
    const t = setup();
    useDebugStore.getState().setAutoDiscardEq(true);
    useDebugStore.getState().setAutoDiscardEq(false);
    expect(await t.pull()).toBe(false);
    expect(t.scope.confirmDialog).toHaveBeenCalledOnce();
  });
});
