// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Shared structured error classification for Glacier EQ domain logic.
//!
//! Domain functions still use `Result<T, String>` at the boundary for ergonomics,
//! but a machine-checkable [`ErrorKind`] is derived from a message via
//! [`classify_error`] so disconnect handling and IPC error routing no longer rely
//! on duplicated, hand-maintained substring lists.

use serde::{Deserialize, Serialize};

/// Machine-checkable classification of an error.
///
/// Serialized (PascalCase) as the `kind` field in the wire form, e.g.
/// `"Disconnected"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum ErrorKind {
    Disconnected,
    Validation,
    Protocol,
    Io,
    Timeout,
    NotFound,
    Unsupported,
}

/// Returns the [`ErrorKind`] for an error message.
///
/// Centralizes the substring heuristics that previously lived in two divergent
/// places (`handle_disconnection` in the Tauri command layer and the frontend's
/// `isDisconnectionError`). Keep this as the single source of truth.
pub fn classify_error(message: &str) -> ErrorKind {
    let lower = message.to_lowercase();

    if [
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
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return ErrorKind::Disconnected;
    }

    if lower.contains("timeout") || lower.contains("timed out") {
        return ErrorKind::Timeout;
    }

    if lower.contains("not found") || lower.contains("unknown") {
        return ErrorKind::NotFound;
    }

    if lower.contains("unsupported") || lower.contains("not supported") {
        return ErrorKind::Unsupported;
    }

    if lower.contains("protocol") || lower.contains("checksum") || lower.contains("mismatch") {
        return ErrorKind::Protocol;
    }

    if lower.contains("invalid") || lower.contains("validation") {
        return ErrorKind::Validation;
    }

    ErrorKind::Io
}

/// Returns true if the error message indicates a device disconnection.
pub fn is_disconnection(message: &str) -> bool {
    matches!(classify_error(message), ErrorKind::Disconnected)
}
