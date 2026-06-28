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

// Logging is configured by the application binary, not this crate.

// Re-exports
pub use device::{
    get_device_profile, get_supported_device, is_supported_device, DeviceCapabilities, DeviceInfo,
    DeviceProfile, DeviceProtocol, FilterTypeFlags, SupportedDevice, WalkplayProtocol, PROFILES,
    SUPPORTED_DEVICES,
};
pub use eq::constants::*;
pub use eq::{snap_freq_to_iso, snap_gain_step, snap_q_to_iso, Filter, FilterType, PEQData};
