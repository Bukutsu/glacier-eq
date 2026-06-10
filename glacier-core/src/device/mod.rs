// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Device abstraction: supported devices, their protocols, and discovery interfaces.
//!
//! UI-agnostic — usable from Tauri desktop/mobile apps, CLI tools, or headless services.

pub mod capabilities;
#[allow(clippy::module_inception)]
pub mod device;
pub mod io;
pub mod profile;
pub mod protocol;
pub mod supported;
pub mod timing;

pub use capabilities::{DeviceCapabilities, FilterTypeFlags};
pub use device::DeviceInfo;
pub use io::{DiscoveryProvider, HidPacketFramer, PacketFramer, PhysicalInterface};
pub use profile::DeviceProfile;
pub use protocol::DeviceProtocol;
pub use supported::{
    get_supported_device, is_supported_device, SupportedDevice, SUPPORTED_DEVICES,
};
pub use timing::{ReadTiming, WriteTiming};
