// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Core domain logic independent of UI, persistence, or hardware specifics.
//!
//! This crate contains the business logic for parametric EQ filtering and
//! USB DAC device protocols. It has **zero GUI dependencies**, making it
//! reusable from Tauri desktop/mobile apps, CLI tools, or headless services.

pub mod autoeq;
pub mod device;
pub mod eq;
pub mod profile_match;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

// Logging is configured by the application binary, not this crate.

// Re-exports
pub use device::{
    get_supported_device, DeviceCapabilities, DeviceInfo, DeviceProfile, DeviceProtocol,
    EqProtocol, Packet, WalkplayProtocol, SUPPORTED_DEVICES,
};
pub use eq::constants::*;
pub use eq::{snap_freq_to_iso, Filter, FilterType, PEQData};
