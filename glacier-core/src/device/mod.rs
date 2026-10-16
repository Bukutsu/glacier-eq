// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Device abstraction: supported devices, their protocols, and discovery interfaces.
//!
//! UI-agnostic — usable from Tauri desktop/mobile apps, CLI tools, or headless services.

pub mod capabilities;
pub mod catalog;
pub mod families;
pub mod normalization;
pub mod packet;
pub mod profile;
pub mod protocol;
pub mod session;
pub mod timing;
pub mod udev;

pub use capabilities::{DeviceCapabilities, EditorCapabilities};
pub use catalog::{get_supported_device, SUPPORTED_DEVICES};
pub use families::dawn_pro;
pub use families::walkplay::DacUtilityState;
pub use families::walkplay::WalkplayProtocol;
pub(crate) use normalization::validate_peq_for_capabilities;
pub use normalization::{
    is_default_peq_for_device, normalize_peq_for_capabilities, normalize_peq_for_device,
    normalize_peq_for_profile, validate_peq,
};
pub use packet::Packet;
pub use profile::{Controls, DacSpec, DeviceInfo, DeviceProfile, SupportedDeviceInfo};
pub use protocol::{EqProtocol, GainEncoding, Protocol, Quirks, UNKNOWN};
pub use session::{block_on, BlockingDeviceIo, DeviceIo, DeviceSession, HID_READ_BUFFER_BYTES};

pub use timing::WriteTiming;
