import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLiveApplier,
  LIVE_APPLY_DELAY_MS,
  LIVE_BUSY_RETRY_MS,
  LIVE_SAVE_DELAY_MS,
  type LiveApplyState,
} from "@/features/device/operations/liveApply";
import { buildDefaultState } from "@/features/eq/lib/peq";
import type { DeviceCapabilities } from "@/types";

const CAPS: DeviceCapabilities = {
  num_bands: 10,
  global_gain_range: [-10, 10],
  band_gain_range: [-12, 12],
  freq_range: [20, 20000],
  q_range: [0.1, 10],
  supported_filter_types: ["Peak"],
  supports_per_band_enable: true,
  supports_ram_apply: true,
  dsp_sample_rate: 96000,
  integer_preamp: false,
};

function setup(overrides: Partial<LiveApplyState> = {}) {
  const state: LiveApplyState = {
    peq: buildDefaultState(),
    unsaved: true,
    busy: false,
    capabilities: CAPS,
    ...overrides,
  };
  const invoke = vi.fn(async (_command: string, _args?: unknown) => ({}));
  const reportError = vi.fn();
  const save = vi.fn(async () => {});
  const applier = createLiveApplier({
    invoke: invoke as never,
    getState: () => state,
    save,
    reportError,
  });
  return { state, invoke, reportError, save, applier };
}

describe("createLiveApplier", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns a burst of edits into one write after the delay", async () => {
    const { applier, invoke } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS - 1);
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS - 1);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "live_apply_eq_state",
      expect.objectContaining({ peq: expect.any(Object) }),
    );
  });

  it("writes nothing while the editor matches the stored EQ", async () => {
    const { applier, invoke } = setup({ unsaved: false });
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the stored EQ again when edits are undone", async () => {
    const { applier, invoke, state } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    state.unsaved = false;
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
    // RAM matches the stored EQ again; nothing further to send.
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not resend after a save or read marks the DAC synced", async () => {
    const { applier, invoke, state } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    state.unsaved = false;
    applier.markSynced();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("holds an edit while another EQ operation runs, then applies it", async () => {
    const { applier, invoke, state } = setup({ busy: true });
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).not.toHaveBeenCalled();
    state.busy = false;
    await vi.advanceTimersByTimeAsync(LIVE_BUSY_RETRY_MS);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("saves once the edits have stopped, not after each one", async () => {
    const { applier, save } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS - 1);
    // Another edit pushes the save back.
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("can preview edits without saving them automatically", async () => {
    const { applier, invoke, save } = setup({ autoSave: false });
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not save an EQ that already matches the DAC", async () => {
    const { applier, save, state } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    state.unsaved = false;
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
  });

  it("stops saving when live apply is switched off", async () => {
    const { applier, save } = setup();
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    applier.stop();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
  });

  it("applies the newest edit after an in-flight write finishes", async () => {
    const { applier, invoke, state } = setup();
    let release!: () => void;
    invoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({}))),
    );
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    state.peq = { ...state.peq, global_gain: -2 };
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(invoke).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toMatchObject({
      peq: { global_gain: -2 },
    });
  });

  it("reports a failed write but not a lost device", async () => {
    const { applier, invoke, reportError } = setup();
    invoke.mockRejectedValueOnce(new Error("Band 1 write failed"));
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(reportError).toHaveBeenCalledWith(
      "Live apply failed: Error: Band 1 write failed",
    );

    invoke.mockRejectedValueOnce("Device disconnected");
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
  it("drains an in-flight preview without resurrecting its old bank's save timer", async () => {
    const { applier, invoke, save } = setup();
    let release!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS);
    let drained = false;
    const pending = applier.pause().then(() => {
      drained = true;
    });
    expect(drained).toBe(false);
    release();
    await pending;
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it("contains failed autosaves instead of producing an unhandled rejection", async () => {
    const { applier, save, reportError } = setup();
    save.mockRejectedValueOnce(new Error("verify failed"));
    applier.schedule();
    await vi.advanceTimersByTimeAsync(LIVE_APPLY_DELAY_MS + LIVE_SAVE_DELAY_MS);
    expect(reportError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledOnce();
  });
});
