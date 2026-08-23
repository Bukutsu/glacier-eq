import { describe, expect, it } from "vitest";
import type { PEQData } from "../types";
import {
  constrainPeqToBandCount,
  peqVerificationError,
  persistentPushFailureMessage,
  shouldRetryWebHidRead,
  WebHidReadTimeout,
} from "./rpc";

function peqWithBands(count: number): PEQData {
  return {
    global_gain: -2,
    filters: Array.from({ length: count }, (_, index) => ({
      index,
      enabled: true,
      filter_type: "Peak",
      freq: 100 + index,
      gain: index,
      q: 0.7,
    })),
  };
}

const VERIFICATION_CAPS = {
  supports_per_band_enable: true,
  gain_tolerance: 0.15,
  freq_tolerance: 1,
  q_tolerance: 0.05,
};

function verificationPeq(): PEQData {
  return {
    global_gain: -1,
    filters: [
      { index: 0, enabled: true, filter_type: "LowShelf", freq: 100, gain: 1, q: 0.7 },
      { index: 1, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
    ],
  };
}

describe("constrainPeqToBandCount", () => {
  it("truncates UI slots beyond the device band count", () => {
    const constrained = constrainPeqToBandCount(peqWithBands(10), 5);

    expect(constrained.filters).toHaveLength(5);
    expect(constrained.filters.map((filter) => filter.freq)).toEqual([100, 101, 102, 103, 104]);
    expect(constrained.global_gain).toBe(-2);
  });

  it("pads missing slots with safe disabled filters", () => {
    const constrained = constrainPeqToBandCount(peqWithBands(2), 5);

    expect(constrained.filters).toHaveLength(5);
    expect(constrained.filters.slice(2)).toEqual([
      { index: 2, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
      { index: 3, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
      { index: 4, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
    ]);
  });
});

describe("peqVerificationError", () => {
  it("accepts protocol readback within the capability tolerances", () => {
    const actual = verificationPeq();
    actual.filters[0] = { ...actual.filters[0], freq: 101, gain: 1.149, q: 0.749 };

    expect(peqVerificationError(actual, verificationPeq(), VERIFICATION_CAPS)).toBeNull();
  });

  it("treats a disabled band's expected gain as zero", () => {
    const expected = verificationPeq();
    expected.filters[1].gain = 8;

    expect(peqVerificationError(verificationPeq(), expected, VERIFICATION_CAPS)).toBeNull();
  });

  it.each([
    ["global gain", (peq: PEQData) => { peq.global_gain = -0.9; }],
    ["filter count", (peq: PEQData) => { peq.filters.pop(); }],
    ["enabled state", (peq: PEQData) => { peq.filters[0].enabled = false; }],
    ["filter type", (peq: PEQData) => { peq.filters[0].filter_type = "Peak"; }],
    ["frequency", (peq: PEQData) => { peq.filters[0].freq = 102; }],
    ["gain", (peq: PEQData) => { peq.filters[0].gain = 1.16; }],
    ["Q", (peq: PEQData) => { peq.filters[0].q = 0.76; }],
  ])("rejects a %s mismatch", (_field, mutate) => {
    const actual = verificationPeq();
    mutate(actual);

    expect(peqVerificationError(actual, verificationPeq(), VERIFICATION_CAPS)).not.toBeNull();
  });

  it("ignores enabled readback when the protocol represents disable as zero gain", () => {
    const actual = verificationPeq();
    actual.filters[1].enabled = true;

    expect(peqVerificationError(actual, verificationPeq(), {
      ...VERIFICATION_CAPS,
      supports_per_band_enable: false,
    })).toBeNull();
  });
});

describe("WebHID report retry classification", () => {
  it("retries its own timeout while connected", () => {
    expect(shouldRetryWebHidRead(new WebHidReadTimeout(), true)).toBe(true);
  });

  it("does not retry timeouts after disconnection", () => {
    expect(shouldRetryWebHidRead(new WebHidReadTimeout(), false)).toBe(false);
  });

  it("does not swallow transport failures", () => {
    expect(shouldRetryWebHidRead(new Error("sendReport failed"), true)).toBe(false);
  });
});

describe("persistentPushFailureMessage", () => {
  it("reports a successful restore", () => {
    expect(persistentPushFailureMessage(new Error("write failed"), null)).toBe(
      "Persistent push failed: write failed; previous state restored",
    );
  });

  it("reports a failed restore", () => {
    expect(persistentPushFailureMessage("commit failed", new Error("device disconnected"))).toBe(
      "Persistent push failed: commit failed; restore failed: device disconnected",
    );
  });
});
