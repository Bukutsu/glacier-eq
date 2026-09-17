import { describe, expect, it } from "vitest";
import { restoreHistorySnapshot } from "./restoredHistory";
import { buildDefaultState } from "./peq";
import { OFFLINE_EDITOR_CAPABILITIES } from "./dacSpecs";
import type { PEQData } from "../types";

// Snapshot as stored by a device with more bands, wider ranges, an
// unsupported filter type, and a fractional preamp.
const foreignSnapshot: PEQData = {
  global_gain: -4.6,
  filters: [
    { index: 0, enabled: true, filter_type: "Notch", freq: 15, gain: 12, q: 40 },
    { index: 1, enabled: true, filter_type: "Peak", freq: 999, gain: -3.5, q: 0.4 },
    ...Array.from({ length: 8 }, (_, i) => ({
      index: i + 2,
      enabled: true,
      filter_type: "Peak",
      freq: 1000 * (i + 2),
      gain: 0,
      q: 1,
    })),
  ],
};

describe("restoreHistorySnapshot", () => {
  it("normalizes a foreign snapshot to editor capabilities and derives dirty state", () => {
    const restored = restoreHistorySnapshot({
      restore: (current, normalize) => normalize(foreignSnapshot) ?? current,
      current: buildDefaultState(),
      clean: buildDefaultState(),
      capabilities: OFFLINE_EDITOR_CAPABILITIES,
    });

    expect(restored).not.toBeNull();
    const { peq, dirty } = restored!;
    expect(peq.filters.length).toBe(10);
    expect(peq.filters[0].filter_type).toBe("Peak"); // Notch is unsupported
    expect(peq.filters[0].freq).toBe(20); // clamped to freq_range
    expect(peq.filters[0].gain).toBe(10); // clamped to band_gain_range
    expect(peq.filters[0].q).toBe(20); // clamped to q_range
    expect(peq.filters[1].q).toBe(0.4); // still below the supported minimum
    expect(peq.global_gain).toBe(-4.6); // within the offline preamp range
    expect(dirty).toBe(true);
  });

  it("reports clean when the normalized snapshot equals the clean state", () => {
    const restored = restoreHistorySnapshot({
      restore: (_current, normalize) => normalize(buildDefaultState()),
      current: buildDefaultState(),
      clean: buildDefaultState(),
      capabilities: OFFLINE_EDITOR_CAPABILITIES,
    });

    expect(restored?.peq).toEqual(buildDefaultState());
    expect(restored?.dirty).toBe(false);
  });

  it("returns null when the store has nothing to restore", () => {
    const restored = restoreHistorySnapshot({
      restore: () => null,
      current: buildDefaultState(),
      clean: buildDefaultState(),
      capabilities: OFFLINE_EDITOR_CAPABILITIES,
    });

    expect(restored).toBeNull();
  });
});
