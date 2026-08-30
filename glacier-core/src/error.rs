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
    "transfer failed",
    "no longer exists",
    "device disconnected",
    "no device connected",
    "no supported dac connected",
    "device is closed",
    "device closed",
];

/// On Windows errno 5 is ERROR_ACCESS_DENIED (permissions/locked device), not a
/// disconnect; on Linux/macOS it maps to EIO, which correlates with USB resets.
#[cfg(not(target_os = "windows"))]
const PLATFORM_DISCONNECT_NEEDLES: &[&str] = &["os error 5"];
#[cfg(target_os = "windows")]
const PLATFORM_DISCONNECT_NEEDLES: &[&str] = &[];

/// Returns true if the error message indicates a device disconnection.
pub fn is_disconnection(message: &str) -> bool {
    let lower = message.to_lowercase();
    DISCONNECT_NEEDLES
        .iter()
        .chain(PLATFORM_DISCONNECT_NEEDLES.iter())
        .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_disconnection_errors() {
        assert!(is_disconnection("Cannot write: device is closed"));
        assert!(is_disconnection("Device closed: /dev/bus/usb/001/002"));
        assert!(is_disconnection("HidError: device disconnected"));
        assert!(is_disconnection("No such device (os error 19)"));
        assert!(!is_disconnection("Checksum verification failed"));
        assert!(!is_disconnection("Invalid frequency range"));
    }
}
