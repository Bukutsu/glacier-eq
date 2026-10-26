import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDacCompare } from "./useDacCompare";
import {
  createLiveApplier,
  LIVE_APPLY_DELAY_MS,
  LIVE_SAVE_DELAY_MS,
  type LiveApplyState,
} from "../operations/liveApply";
import { buildDevDummyPeq, DEV_DUMMY_DEVICE } from "../lib/devDevice";
import type { PEQData } from "@/types";

const hooks = vi.hoisted(() => ({
  ref: null as { current: unknown } | null,
  memo: null as unknown,
  memoDeps: [] as unknown[],
  effectDeps: [] as unknown[],
  cleanup: undefined as (() => void) | undefined,
  effect: undefined as (() => () => void) | undefined,
  invoke: vi.fn(),
}));
vi.mock("react", async () => ({
  ...await vi.importActual("react"),
  useRef: (value: unknown) => (hooks.ref ??= { current: value }),
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    if (deps.some((value, index) => value !== hooks.memoDeps[index])) {
      hooks.memo = factory();
      hooks.memoDeps = deps;
    }
    return hooks.memo;
  },
  useEffect: (effect: () => () => void, deps: unknown[]) => {
    if (deps.some((value, index) => value !== hooks.effectDeps[index])) {
      hooks.cleanup?.();
      hooks.effect = effect;
      hooks.cleanup = effect();
      hooks.effectDeps = deps;
    }
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/rpc", () => ({ invoke: hooks.invoke }));

function setup() {
  const busyRef = { current: false };
  const state: LiveApplyState = {
    peq: buildDevDummyPeq(), unsaved: true, busy: false,
    capabilities: DEV_DUMMY_DEVICE,
  };
  const save = vi.fn(async () => {});
  const reportStatus = vi.fn();
  const live = createLiveApplier({
    invoke: hooks.invoke,
    getState: () => ({ ...state, busy: busyRef.current }),
    save,
    reportError: (error) => { throw new Error(error); },
  });
  let scope = "device:1";
  const options = {
    playing: state.peq, capabilities: state.capabilities, busy: false,
    busyRef, path: "physical-device", scopeKey: scope,
    getScopeKey: () => scope, live, liveActive: true, reportStatus,
  };
  const compare = useDacCompare(options);
  return {
    state, busyRef, save, reportStatus, live, compare, options,
    replaceSession: () => { scope = "device:2"; },
  };
}

function writtenPeq(index: number): PEQData {
  return hooks.invoke.mock.calls[index][1].peq;
}

describe("compare/live preview ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.ref = null;
    hooks.memo = null;
    hooks.memoDeps = [];
    hooks.effectDeps = [];
    hooks.cleanup = undefined;
    hooks.invoke.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    hooks.cleanup?.();
    vi.useRealTimers();
  });

  it.each([false, true])("holds bypass across edits and resumes the latest EQ (undo=%s)", async (undo) => {
    const { state, busyRef, save, live, compare, options } = setup();
    live.schedule();
    await compare.start();
    expect(busyRef.current).toBe(true);
    expect(writtenPeq(0).filters.every((band) => !band.enabled)).toBe(true);

    state.peq = { ...state.peq, global_gain: -4 };
    state.unsaved = !undo;
    useDacCompare({ ...options, playing: state.peq });
    live.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(hooks.invoke).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    await compare.end();
    expect(busyRef.current).toBe(false);
    expect(writtenPeq(1).global_gain).toBe(options.playing.global_gain);
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(writtenPeq(2).global_gain).toBe(-4);
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(undo ? 0 : 1);
    live.stop();
  });

  it("resumes preview after an effect teardown/setup replay", async () => {
    const { compare, live } = setup();
    hooks.cleanup?.();
    hooks.cleanup = hooks.effect?.();
    await compare.start();
    await compare.end();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(hooks.invoke).toHaveBeenCalledTimes(3);
    live.stop();
  });

  it("drains an in-flight preview and retains ownership through quick-tap restore", async () => {
    const { busyRef, live, compare } = setup();
    let finishPreview = () => {};
    let finishRestore = () => {};
    hooks.invoke
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreview = resolve; }))
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishRestore = resolve; }));
    live.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    void compare.start();
    const ended = compare.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.invoke).toHaveBeenCalledTimes(1);
    finishPreview();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.invoke).toHaveBeenCalledTimes(3);
    expect(writtenPeq(1).filters.every((band) => !band.enabled)).toBe(true);
    expect(busyRef.current).toBe(true);
    live.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(hooks.invoke).toHaveBeenCalledTimes(3);
    finishRestore();
    await ended;
    expect(busyRef.current).toBe(false);
    live.stop();
  });

  it("waits for an autosave already in flight before bypassing", async () => {
    const { save, live, compare } = setup();
    let finishSave = () => {};
    save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    live.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS + LIVE_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledOnce();
    const started = compare.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.invoke).toHaveBeenCalledTimes(1);
    finishSave();
    await started;
    expect(hooks.invoke).toHaveBeenCalledTimes(2);
    await compare.end();
    live.stop();
  });

  it("drops queued bypass/restore on session replacement without resuming the old preview", async () => {
    const { options, busyRef, live, compare, replaceSession } = setup();
    let finishPreview = () => {};
    hooks.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreview = resolve; }));
    live.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    void compare.start();
    replaceSession();
    useDacCompare({ ...options, scopeKey: "device:2" });
    finishPreview();
    await compare.end();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(hooks.invoke).toHaveBeenCalledTimes(1);
    expect(busyRef.current).toBe(false);
    live.stop();
  });

  it("releases ownership on restore failure and on unmount", async () => {
    const { reportStatus, busyRef, live, compare } = setup();
    await compare.start();
    hooks.invoke.mockRejectedValueOnce(new Error("restore failed"));
    hooks.cleanup?.();
    await compare.end();
    expect(reportStatus).toHaveBeenCalledOnce();
    expect(busyRef.current).toBe(false);
    await compare.start();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(hooks.invoke).toHaveBeenCalledTimes(2);
    live.stop();
  });
});
