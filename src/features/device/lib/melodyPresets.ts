// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

// Preset ids FiiO Control Web offers for the SNOWSKY Melody (command 0x16);
// the Rust codec in families/fiio/melody.rs must list the same values.
export const MELODY_PRESETS = [
  { value: 0, key: "jazz" },
  { value: 1, key: "pop" },
  { value: 2, key: "rock" },
  { value: 3, key: "dance" },
  { value: 4, key: "rb" },
  { value: 5, key: "classic" },
  { value: 6, key: "hiphop" },
  { value: 160, key: "user1" },
  { value: 161, key: "user2" },
  { value: 162, key: "user3" },
  { value: 240, key: "off" },
] as const;

export const MELODY_PRESET_VALUES: readonly number[] = MELODY_PRESETS.map(
  (preset) => preset.value,
);
