// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Generic hardware-agnostic traits for physical device interfaces, framers, and discovery providers.

use crate::device::device::DeviceInfo;
use crate::error::{AppError, ErrorKind, Result};

/// A generic connection interface representing physical communication with a DAC device.
///
/// **Contract:** Implementations must be accessed sequentially from a single
/// thread or behind a serialization layer (e.g. an async worker processing
/// commands one-at-a-time). Concurrent reads and writes will corrupt USB
/// protocol state (nonce interleaving, packet framing).
pub trait PhysicalInterface: Send {
    /// Writes raw payload bytes to the underlying transport stream.
    fn write(&self, data: &[u8]) -> Result<usize>;

    /// Reads raw response bytes from the underlying transport stream.
    fn read_timeout(&self, data: &mut [u8], timeout_ms: u32) -> Result<usize>;

    /// Drains/flushes any stale bytes sitting in the queue buffer.
    fn flush(&self) -> Result<()>;
}

/// Abstract framing format to translate between raw payload bytes and physical packet bytes.
pub trait PacketFramer: Send + Sync {
    /// Wraps a raw payload (e.g. prepends a report ID, or adds serial framing headers and CRCs).
    fn frame_packet(&self, payload: &[u8]) -> Vec<u8>;

    /// Unwraps and validates an incoming packet, stripping packaging headers.
    fn unframe_packet(&self, framed: &[u8]) -> Result<Vec<u8>>;
}

/// Generic provider capable of discovering and connecting to devices.
pub trait DiscoveryProvider: Send + Sync {
    /// Probes the physical environment to locate compatible devices.
    fn list_devices(&self) -> Result<Vec<DeviceInfo>>;

    /// Opens a connection to a specific device handle.
    fn open_device(&self, info: &DeviceInfo) -> Result<Box<dyn PhysicalInterface>>;
}

/// A standard HID report framer that prepends a Report ID byte and pads outgoing frames to 65 bytes.
pub struct HidPacketFramer {
    report_id: u8,
}

impl HidPacketFramer {
    pub fn new(report_id: u8) -> Self {
        Self { report_id }
    }
}

impl PacketFramer for HidPacketFramer {
    fn frame_packet(&self, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 65];
        buf[0] = self.report_id;
        let len = payload.len().min(64);
        buf[1..1 + len].copy_from_slice(&payload[..len]);
        buf
    }

    fn unframe_packet(&self, framed: &[u8]) -> Result<Vec<u8>> {
        if framed.is_empty() {
            return Err(AppError::new(
                ErrorKind::HardwareError,
                "Received empty framed packet",
            ));
        }
        let offset = if framed[0] == self.report_id { 1 } else { 0 };
        Ok(framed[offset..].to_vec())
    }
}
