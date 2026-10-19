import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const check = vi.fn();
vi.mock("@/lib/rpc", () => ({ invoke }));
vi.mock("@/lib/platform", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));

let useToastStore: typeof import("@/stores/toastStore").useToastStore;

function fakeUpdate(version = "9.9.9") {
  return {
    version,
    body: "- faster\n",
    close: vi.fn(async () => {}),
    download: vi.fn(
      async (onEvent: (event: Record<string, unknown>) => void) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        onEvent({ event: "Finished" });
      },
    ),
    install: vi.fn(async () => {}),
  };
}

beforeEach(() => vi.resetAllMocks());

// detect() memoizes per module instance, so every test reloads the module
// (and with it the toast store the module writes to).
async function fresh() {
  vi.resetModules();
  ({ useToastStore } = await import("@/stores/toastStore"));
  return (await import("./useAppUpdate")).useAppUpdate;
}

describe("update support", () => {
  it("never touches the updater on a build that cannot update", async () => {
    invoke.mockResolvedValue({ supported: false, reason: "systemPackage" });
    const store = await fresh();
    await store.getState().checkOnLaunch();
    await store.getState().check();
    expect(store.getState().state).toEqual({
      phase: "unsupported",
      reason: "systemPackage",
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("surfaces a failed support probe instead of guessing", async () => {
    invoke.mockRejectedValue(new Error("no such command"));
    const store = await fresh();
    await store.getState().detect();
    expect(store.getState().state).toEqual({
      phase: "error",
      message: "no such command",
    });
  });
});

describe("update flow", () => {
  it("announces a newer release once on launch", async () => {
    invoke.mockResolvedValue({ supported: true, reason: null });
    check.mockResolvedValue(fakeUpdate());
    const store = await fresh();
    await store.getState().checkOnLaunch();
    expect(store.getState().state).toMatchObject({
      phase: "available",
      version: "9.9.9",
      notes: "- faster",
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("stays quiet at launch when current or offline", async () => {
    invoke.mockResolvedValue({ supported: true, reason: null });
    check.mockResolvedValueOnce(null);
    const store = await fresh();
    await store.getState().checkOnLaunch();
    expect(store.getState().state).toEqual({ phase: "upToDate" });
    check.mockRejectedValueOnce(new Error("offline"));
    await store.getState().check();
    expect(store.getState().state).toMatchObject({ phase: "error" });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("downloads with progress, then installs and restarts only on request", async () => {
    invoke.mockResolvedValue({ supported: true, reason: null });
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    const store = await fresh();
    await store.getState().check();

    await store.getState().install(); // not downloaded yet: ignored
    expect(update.install).not.toHaveBeenCalled();

    await store.getState().download();
    expect(store.getState().state).toEqual({
      phase: "ready",
      version: "9.9.9",
    });
    expect(update.install).not.toHaveBeenCalled();

    await store.getState().install();
    expect(update.install).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith("restart_app");
  });

  it("reports a failed download and allows another check", async () => {
    invoke.mockResolvedValue({ supported: true, reason: null });
    const update = fakeUpdate();
    update.download.mockRejectedValue(new Error("signature mismatch"));
    check.mockResolvedValue(update);
    const store = await fresh();
    await store.getState().check();
    await store.getState().download();
    expect(store.getState().state).toEqual({
      phase: "error",
      message: "signature mismatch",
    });
    check.mockResolvedValue(null);
    await store.getState().check();
    expect(store.getState().state).toEqual({ phase: "upToDate" });
  });
});
