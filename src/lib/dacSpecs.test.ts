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

  it("falls back to VID match when PID is null or generic", () => {
    const spec = getOfficialDacSpec(0x2fc6, 0x9999);
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("Moondrop Dawn Pro");
    expect(spec?.chip).toBe("Dual CS43131");
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

  it("finds FiiO KA Series by VID fallback when PID is null", () => {
    const spec = getOfficialDacSpec(0x2972, null);
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("FiiO KA Series");
  });

  it("resolves all supported hardware models from glacier-core", () => {
    const models = [
      { vid: 0x3302, pid: 0x43e6, expected: "EPZ TP35 Pro" },
      { vid: 0x3302, pid: 0x43e8, expected: "TRN Black Pearl" },
      { vid: 0x3302, pid: null, expected: "Audiocular Aura" },
      { vid: 0x262a, pid: null, expected: "Fosi Audio DS2 / iBasso DC04 Pro" },
      { vid: 0x0661, pid: null, expected: "JCally JM20 / Savitech Generic" },
      { vid: 0x0666, pid: null, expected: "JCally JM20 Pro / Alt Savitech" },
      { vid: 0x2fc6, pid: null, expected: "Moondrop Dawn Pro" },
      { vid: 0x35d8, pid: 0x011d, expected: "Moondrop Dawn Pro 2" },
      { vid: 0x2972, pid: 0x0102, expected: "FiiO JA11" },
      { vid: 0x31b2, pid: 0x0111, expected: "JCally JM12" },
      { vid: 0x2972, pid: null, expected: "FiiO KA Series" },
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
