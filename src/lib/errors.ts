// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

const DISCONNECT_NEEDLES = [
  "no such device",
  "device not found",
  "disconnected",
  "not open",
  "io error",
  "os error 19",
  "transfer failed",
  "no longer exists",
  "device disconnected",
  "no device connected",
  "no supported dac connected",
  "device is closed",
  "device closed",
];

export function isWindowsPlatform(platformName?: string): boolean {
  const platform = platformName ?? (typeof navigator === "undefined" ? "" : navigator.platform);
  return platform.toLowerCase().startsWith("win");
}

export function isDisconnectionErrorForPlatform(error: unknown, windows: boolean): boolean {
  const lower = String(error).toLowerCase();
  return DISCONNECT_NEEDLES.some((needle) => lower.includes(needle)) ||
    (!windows && lower.includes("os error 5"));
}

export function isDisconnectionError(error: unknown): boolean {
  return isDisconnectionErrorForPlatform(error, isWindowsPlatform());
}
