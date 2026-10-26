// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, save } from "@/lib/rpc";
import { exportEqFile } from "./exportEq";

vi.mock("@/lib/rpc", () => ({
  invoke: vi.fn(),
  save: vi.fn(),
  writeText: vi.fn(),
}));

describe("exportEqFile suggested filename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue("Preamp: 0 dB");
    vi.mocked(save).mockResolvedValue(null);
  });

  it.each([
    ["日本語", "日本語.txt"],
    ["ดนตรี", "ดนตรี.txt"],
    ["Rock ロック", "Rock ロック.txt"],
    ["Rock ดนตรี", "Rock ดนตรี.txt"],
    ["Cafe\u0301", "Cafe\u0301.txt"],
    ["Rock_2-@+&.()", "Rock_2-@+&.().txt"],
    ["Rock/ロック:*?", "Rockロック.txt"],
    ["", "eq_profile.txt"],
    ["/:*?<>|", "eq_profile.txt"],
    ["   /:*?   ", "eq_profile.txt"],
    ["  日本語  ", "日本語.txt"],
  ])("profile %j suggests %j", async (baseName, expected) => {
    await exportEqFile({ filters: [], global_gain: 0 }, baseName, vi.fn());

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: expected }),
    );
    expect(invoke).toHaveBeenCalledWith("peq_to_autoeq", {
      peq: { filters: [], global_gain: 0 },
    });
  });
});
