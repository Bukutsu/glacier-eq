// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { profileIdentityKey } from "./profileIdentity";

describe("profileIdentityKey", () => {
  it("folds ASCII case differences like ProfileStore's eq_ignore_ascii_case", () => {
    expect(profileIdentityKey("Daily")).toBe(profileIdentityKey("daily"));
    expect(profileIdentityKey("IEM")).toBe(profileIdentityKey("iem"));
    expect(profileIdentityKey("A B_c")).toBe(profileIdentityKey("a b_c"));
  });

  it("keeps non-ASCII names distinct, matching desktop file-per-name storage", () => {
    // Rust eq_ignore_ascii_case("É", "é") is false: desktop stores both.
    expect(profileIdentityKey("É")).not.toBe(profileIdentityKey("é"));
  });

  it("is locale-independent for the Turkish dotted/dotless I", () => {
    // toLocaleLowerCase('tr') maps I->ı, which made web delete a no-op.
    expect(profileIdentityKey("I")).toBe("i");
    expect(profileIdentityKey("İ")).toBe("İ");
    expect(profileIdentityKey("ı")).toBe("ı");
  });

  it("preserves astral-plane characters intact while folding nearby ASCII", () => {
    expect(profileIdentityKey("𝒜BC")).toBe("𝒜bc");
    expect(profileIdentityKey("𝒜bc")).toBe("𝒜bc");
  });
});
