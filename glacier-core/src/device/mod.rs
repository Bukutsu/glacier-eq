// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Device abstraction: supported devices, their protocols, and discovery interfaces.
//!
//! UI-agnostic — usable from Tauri desktop/mobile apps, CLI tools, or headless services.

pub mod capabilities;
pub mod fiio;
pub mod moondrop;
pub mod normalization;
pub mod profile;
pub mod protocol;
pub mod session;
pub mod supported;
pub mod timing;
pub mod walkplay;

pub use capabilities::{DeviceCapabilities, EditorCapabilities};
pub use normalization::{
    is_default_peq_for_device, normalize_peq_for_capabilities, normalize_peq_for_device,
    normalize_peq_for_profile, validate_peq,
};
pub use profile::{DeviceInfo, DeviceProfile, DeviceProtocol};
pub use protocol::{EqProtocol, Packet, WalkplayProtocol};
pub use session::{DacUtilityState, DeviceIo, DeviceSession};
pub use supported::{get_supported_device, SUPPORTED_DEVICES};
pub use timing::WriteTiming;
