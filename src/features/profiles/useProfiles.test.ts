import { describe, expect, it } from "vitest";
import { reconcileProfileSelection } from "./useProfiles";
import { buildDefaultState, DEFAULT_PROFILE_NAME } from "../../lib/peq";
import type { Profile } from "../../types";

const profile = (name: string): Profile => ({
  name,
  data: buildDefaultState(),
  modified: null,
});

describe("reconcileProfileSelection", () => {
  it("keeps a case-insensitive identity match", () => {
    expect(reconcileProfileSelection([profile("Daily")], "daily")).toEqual({
      name: "Daily",
      missing: false,
    });
  });

  it("marks an externally removed selection as missing", () => {
    expect(reconcileProfileSelection([], "Daily")).toEqual({
      name: DEFAULT_PROFILE_NAME,
      missing: true,
    });
  });
});
