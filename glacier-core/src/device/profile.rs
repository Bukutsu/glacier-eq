// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! `DeviceProfile` trait — the identity, capability, and protocol-factory interface
//! for a supported USB DAC model.
//!
//! Concrete profiles live in `crate::hardware::devices`. The static registry that
//! maps VID/PID → profile lives in `crate::hardware::registry`.

use crate::device::capabilities::DeviceCapabilities;
use crate::device::device::DeviceInfo;
use crate::device::protocol::DeviceProtocol;

/// Static capability and identity profile for a supported USB DAC model.
///
/// Implement this trait (in `hardware/devices/<vendor>/mod.rs`) and register
/// the static reference in `hardware::registry::REGISTRY`.
pub trait DeviceProfile: Send + Sync {
    /// The friendly display name of the DAC model.
    fn name(&self) -> &'static str;

    /// The USB Vendor ID.
    fn vendor_id(&self) -> u16;

    /// The USB Product ID.
    fn product_id(&self) -> u16;

    /// Static capability boundaries for EQ frequency, gain, Q, and filter types.
    /// Queried by the UI to constrain sliders and by the pipeline to validate payloads.
    fn capabilities(&self) -> DeviceCapabilities;

    /// Instantiates the USB packet protocol for this device.
    fn protocol(&self) -> Box<dyn DeviceProtocol>;

    /// Optional filter: return `true` if this HID device should be matched to this profile.
    ///
    /// Called after the VID/PID match. Override this when two different products
    /// share the same VID/PID and must be distinguished by product string.
    /// The default returns `true`.
    fn filter_device(&self, _device_info: &DeviceInfo) -> bool {
        true
    }
}
