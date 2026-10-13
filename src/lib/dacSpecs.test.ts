// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { getOfficialDacSpec } from "./dacSpecs";

describe("getOfficialDacSpec", () => {
  it("finds EPZ TP35 Pro by VID and PID", () => {
    const spec = getOfficialDacSpec(0x3302, 0x43e6);
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("EPZ TP35 Pro");
    expect(spec?.chip).toBe("Dual CS43198");
    expect(spec?.outputs).toBe("3.5 / 4.4mm");
    expect(spec?.maxPower).toContain("262mW");
    expect(spec?.decoding).toBe("384k / DSD256");
  });

  it("finds TRN Black Pearl by VID and PID", () => {
    const spec = getOfficialDacSpec(0x3302, 0x43e8);
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("TRN Black Pearl");
    expect(spec?.chip).toBe("Dual CS43131");
    expect(spec?.outputs).toBe("3.5 / 4.4mm");
  });

  it("does not assign another model's specs to an unknown PID", () => {
    expect(getOfficialDacSpec(0x2fc6, 0x9999, "Moondrop Dawn Pro")).toBeNull();
    expect(getOfficialDacSpec(0x3302, 0xffff, "EPZ TP35 Pro")).toBeNull();
  });

  it("finds FiiO JA11 by VID and PID", () => {
    const spec = getOfficialDacSpec(0x2972, 0x0102);
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("FiiO JA11");
    expect(spec?.chip).toContain("KT02H20");
    expect(spec?.outputs).toBe("3.5mm SE");
  });

  it("finds by name substring fallback when VID/PID are missing", () => {
    const spec = getOfficialDacSpec(null, null, "Custom EPZ TP35 PRO connected");
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("EPZ TP35 Pro");
  });

  it("does not assign generic FiiO specs from a vendor ID alone", () => {
    expect(getOfficialDacSpec(0x2972, null)).toBeNull();
  });

  it("resolves exact models with recorded hardware specifications", () => {
    const models = [
      { vid: 0x3302, pid: 0x43e6, expected: "EPZ TP35 Pro" },
      { vid: 0x3302, pid: 0x43e8, expected: "TRN Black Pearl" },
      { vid: 0x3302, pid: 0x43c9, expected: "Audiocular Aura" },
      { vid: 0x3302, pid: 0x43c1, expected: "JCally JM20 Pro" },
      { vid: 0x35d8, pid: 0x011d, expected: "Moondrop Dawn Pro 2" },
      { vid: 0x2972, pid: 0x0102, expected: "FiiO JA11" },
      { vid: 0x0d8c, pid: 0x0210, expected: "Truthear KEYX" },
    ];

    for (const { vid, pid, expected } of models) {
      const spec = getOfficialDacSpec(vid, pid);
      expect(spec, `Expected spec for ${expected}`).not.toBeNull();
      expect(spec?.name).toBe(expected);
      expect(spec?.chip).toBeDefined();
      expect(spec?.outputs).toBeDefined();
    }
  });

  it("returns null for unknown devices", () => {
    const spec = getOfficialDacSpec(0x1234, 0x5678, "Unknown Audio Widget");
    expect(spec).toBeNull();
  });
});
