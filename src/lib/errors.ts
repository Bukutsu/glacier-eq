// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

/// Machine-checkable classification of an error, mirroring
/// `glacier_core::error::ErrorKind` on the Rust side.
export type ErrorKind =
  | "Disconnected"
  | "Validation"
  | "Protocol"
  | "Io"
  | "Timeout"
  | "NotFound"
  | "Unsupported";

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

/// Single source of truth for error classification, shared with the Rust
/// `glacier_core::error::classify_error` helper.
export function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();

  if (DISCONNECT_NEEDLES.some((needle) => lower.includes(needle))) {
    return "Disconnected";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Timeout";
  }
  if (lower.includes("not found") || lower.includes("unknown")) {
    return "NotFound";
  }
  if (lower.includes("unsupported") || lower.includes("not supported")) {
    return "Unsupported";
  }
  if (
    lower.includes("protocol") ||
    lower.includes("checksum") ||
    lower.includes("mismatch")
  ) {
    return "Protocol";
  }
  if (lower.includes("invalid") || lower.includes("validation")) {
    return "Validation";
  }
  return "Io";
}

export function isDisconnectionError(error: unknown): boolean {
  return classifyError(String(error)) === "Disconnected";
}
