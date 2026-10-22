import { describe, expect, it, vi } from "vitest";

import {
  bypassPeq,
  createBypassCompare,
  type BypassCompareState,
} from "@/features/device/operations/compareBypass";
import {
  buildDevDummyPeq,
  DEV_DUMMY_DEVICE,
} from "@/features/device/lib/devDevice";
import type { PEQData } from "@/types";

function setup(overrides: Partial<BypassCompareState> = {}) {
  const state: BypassCompareState = {
    playing: buildDevDummyPeq(),
    capabilities: DEV_DUMMY_DEVICE,
    busy: false,
    ...overrides,
  };
  const applied: PEQData[] = [];
  const apply = vi.fn(async (peq: PEQData) => {
    applied.push(peq);
  });
  const reportError = vi.fn();
  const compare = createBypassCompare({
    apply,
    getState: () => state,
    reportError,
  });
  return { state, apply, applied, reportError, compare };
}

describe("bypassPeq", () => {
  it("turns every filter off and keeps the preamp", () => {
    const peq = buildDevDummyPeq();
    const bypassed = bypassPeq(peq);
    expect(bypassed.filters.every((filter) => !filter.enabled)).toBe(true);
    expect(bypassed.global_gain).toBe(peq.global_gain);
    expect(peq.filters.some((filter) => filter.enabled)).toBe(true);
  });
});

describe("createBypassCompare", () => {
  it("bypasses on start and restores the playing EQ on end", async () => {
    const { compare, applied, state } = setup();
    void compare.start();
    await compare.end();
    expect(applied).toHaveLength(2);
    expect(applied[0].filters.every((filter) => !filter.enabled)).toBe(true);
    expect(applied[1].filters.filter((filter) => filter.enabled)).toHaveLength(
      state.playing.filters.filter((filter) => filter.enabled).length,
    );
  });

  it("restores even when the hold ends before the bypass write finishes", async () => {
    const { compare, apply, state } = setup();
    let finishBypass = () => {};
    apply.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishBypass = resolve)),
    );
    void compare.start();
    const ended = compare.end();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    finishBypass();
    await ended;
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0].global_gain).toBe(state.playing.global_gain);
  });

  it("does nothing while another device operation runs", async () => {
    const { compare, apply } = setup({ busy: true });
    await compare.start();
    await compare.end();
    expect(apply).not.toHaveBeenCalled();
  });

  it("ignores a repeated start and an end without a start", async () => {
    const { compare, apply } = setup();
    await compare.end();
    void compare.start();
    await compare.start();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("reports a failed write and still restores afterwards", async () => {
    const { compare, apply, reportError } = setup();
    apply.mockRejectedValueOnce(new Error("lost"));
    void compare.start();
    await compare.end();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
