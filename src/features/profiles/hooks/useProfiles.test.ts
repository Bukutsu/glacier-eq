import { describe, expect, it } from "vitest";
import { reconcileProfileSelection } from "./useProfiles";
import { buildDefaultState, DEFAULT_PROFILE_NAME } from "@/features/eq/lib/peq";
import type { Profile } from "@/types";

const profile = (name: string): Profile => ({
  name,
  data: buildDefaultState(),
  modified: null,
});

describe("reconcileProfileSelection", () => {
  it("keeps a case-insensitive identity match", () => {
    expect(
      reconcileProfileSelection([profile("Daily")], "daily", [
        profile("Daily"),
      ]),
    ).toEqual({
      name: "Daily",
      missing: false,
    });
  });

  it("marks an externally removed selection as missing", () => {
    expect(reconcileProfileSelection([], "Daily", [profile("Daily")])).toEqual({
      name: DEFAULT_PROFILE_NAME,
      missing: true,
    });
  });

  it("keeps the name of an EQ that was never saved", () => {
    expect(
      reconcileProfileSelection(
        [profile(DEFAULT_PROFILE_NAME)],
        "Yaky @ Harman",
        [profile(DEFAULT_PROFILE_NAME)],
      ),
    ).toEqual({ name: "Yaky @ Harman", missing: false });
  });
});
