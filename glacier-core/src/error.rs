// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Shared error classification for Glacier EQ domain logic.
//!
//! Domain functions return `Result<T, String>` at the boundary; the substring
//! list here lets disconnect handling and IPC error routing avoid duplicated,
//! hand-maintained heuristics.

const DISCONNECT_NEEDLES: &[&str] = &[
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

/// Returns true if the error message indicates a device disconnection.
pub fn is_disconnection(message: &str) -> bool {
    let lower = message.to_lowercase();
    DISCONNECT_NEEDLES
        .iter()
        .any(|needle| lower.contains(needle))
}
