// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

const DISCONNECT_NEEDLES = [
  "no such device",
  "device not found",
  "disconnected",
  "not open",
  "io error",
  "os error 19",
  "os error 5",
  "transfer failed",
  "no longer exists",
  "device disconnected",
  "no device connected",
  "no supported dac connected",
];

export function isDisconnectionError(error: unknown): boolean {
  const lower = String(error).toLowerCase();
  return DISCONNECT_NEEDLES.some((needle) => lower.includes(needle));
}
