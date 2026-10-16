// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! HID packet framing shared by every protocol family.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    pub report_id: u8,
    pub payload: Vec<u8>,
    pub pad_to: Option<usize>,
}

pub(crate) fn checked_scaled_i16(value: f64, scale: f64, label: &str) -> Result<i16, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let scaled = (value * scale).round();
    if !scaled.is_finite() || !(-32768.0..=32767.0).contains(&scaled) {
        return Err(format!("{label} is outside the protocol wire range"));
    }
    Ok(scaled as i16)
}

pub(crate) fn checked_scaled_u16(value: f64, scale: f64, label: &str) -> Result<u16, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let scaled = (value * scale).round();
    if !scaled.is_finite() || !(0.0..=65535.0).contains(&scaled) {
        return Err(format!("{label} is outside the protocol wire range"));
    }
    Ok(scaled as u16)
}

impl Packet {
    pub fn new(report_id: u8, payload: Vec<u8>) -> Self {
        Self {
            report_id,
            payload,
            pad_to: None,
        }
    }

    pub fn padded(report_id: u8, payload: Vec<u8>, pad_to: usize) -> Self {
        Self {
            report_id,
            payload,
            pad_to: Some(pad_to),
        }
    }

    /// Builds the HID report: report ID byte followed by the payload,
    /// zero-padded to the declared report length.
    ///
    /// # Panics
    ///
    /// If the payload exceeds `pad_to`. That is a caller contract violation
    /// (all current packet builders use fixed sizes); failing loudly beats
    /// sending a truncated frame to the device.
    pub fn framed(&self) -> Vec<u8> {
        let payload_len = self.pad_to.unwrap_or(self.payload.len());
        assert!(
            self.payload.len() <= payload_len,
            "payload of {} bytes does not fit padded frame of {payload_len} bytes",
            self.payload.len()
        );
        let mut buf = Vec::with_capacity(payload_len + 1);
        buf.push(self.report_id);
        buf.extend_from_slice(&self.payload);
        buf.resize(payload_len + 1, 0);
        buf
    }
}
