// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Device abstraction: supported devices, their protocols, and discovery interfaces.
//!
//! UI-agnostic — usable from Tauri desktop/mobile apps, CLI tools, or headless services.

pub mod capabilities;
#[allow(clippy::module_inception)]
pub mod device;
pub mod fiio;
pub mod moondrop;
pub mod profile;
pub mod protocol;
pub mod supported;
pub mod timing;
pub mod walkplay;

pub use capabilities::DeviceCapabilities;
pub use device::DeviceInfo;
pub use profile::{DeviceProfile, DeviceProtocol};
pub use protocol::{EqProtocol, Packet, WalkplayProtocol};
pub use supported::{
    get_device_profile, get_supported_device, is_supported_device, SupportedDevice,
    SUPPORTED_DEVICES,
};
pub use timing::{ReadTiming, WriteTiming};
pub use walkplay::PROFILES;
