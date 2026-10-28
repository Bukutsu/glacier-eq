// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! HID transport seam: the `DeviceIo` trait and the session's send/drain/read helpers.

use super::{DeviceSession, Fault, FaultKind};
use crate::device::Packet;

const INIT_DRAIN_ATTEMPTS: usize = 100;
const WRITE_ATTEMPTS: usize = 3;

/// Read buffer size for a HID transport. Every backend that talks to a device
/// through hidapi must size its buffer here, not with a local literal: the
/// CLI used 256 while the privileged helper and the HID plugin used 1024, so
/// a protocol that grew a longer response would have been silently truncated
/// on one transport and not the others. No registered profile produces a
/// frame anywhere near this today (the largest is 40 bytes), which is exactly
/// why the divergence could sit unnoticed.
pub const HID_READ_BUFFER_BYTES: usize = 1024;

/// Minimal asynchronous transport used by the session. Reads return an empty
/// vector on timeout, not an error. Transport errors fail the operation.
#[allow(async_fn_in_trait)]
pub trait DeviceIo {
    async fn write(&mut self, data: &[u8]) -> Result<(), String>;
    async fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String>;
    fn reads_include_report_id(&self) -> bool {
        false
    }
    async fn sleep_ms(&mut self, ms: u64);
}

impl<I: DeviceIo> DeviceSession<'_, I> {
    pub(crate) async fn read_matching(
        &mut self,
        label: &str,
        attempts: usize,
        matches: impl Fn(&[u8]) -> bool,
    ) -> Result<Vec<u8>, Fault> {
        self.require_open_transaction()?;
        let protocol = self.protocol();
        let mut received = 0;
        let mut invalid_frames = 0;
        let mut last_rejected = None;
        for attempt in 1..=attempts {
            let bytes = self.io.read(60).await.map_err(|error| {
                Fault::from(format!("{label} read failed on attempt {attempt}: {error}"))
            })?;
            if bytes.is_empty() {
                continue;
            }
            received += 1;
            let data = if self.io.reads_include_report_id() {
                match protocol.unframe_packet(&bytes) {
                    Ok(data) => data,
                    Err(_) => {
                        invalid_frames += 1;
                        last_rejected = Some(bytes);
                        continue;
                    }
                }
            } else {
                bytes.as_slice()
            };
            if matches(data) {
                return Ok(data.to_vec());
            }
            last_rejected = Some(bytes);
        }
        let mut message = format!("{label} read timeout");
        // A rejected reply is not USB silence. Surface this bounded summary in
        // the existing operation error/log, without adding per-poll log spam.
        if let Some(bytes) = last_rejected {
            let hex = bytes
                .iter()
                .take(24)
                .map(|b| format!("{b:02x}"))
                .collect::<Vec<_>>()
                .join(" ");
            message.push_str(&format!(
                " ({}; received {received} unmatched replies, {invalid_frames} invalid HID frames, {} empty polls; last RX [{} bytes]: {hex})",
                self.profile.protocol.id, attempts - received, bytes.len()
            ));
        }
        Err(Fault::new(FaultKind::ReadTimeout, message))
    }

    pub(crate) async fn drain(&mut self) {
        for _ in 0..INIT_DRAIN_ATTEMPTS {
            match self.io.read(20).await {
                Ok(bytes) if bytes.is_empty() => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }

    pub(crate) async fn send(&mut self, packet: &Packet) -> Result<(), String> {
        self.require_open_transaction()?;
        let framed = packet.framed();
        let mut last = "Write failed".to_string();
        for _ in 0..WRITE_ATTEMPTS {
            match self.io.write(&framed).await {
                Ok(()) => return Ok(()),
                Err(error) => {
                    last = error;
                    self.io
                        .sleep_ms(50.max(self.protocol().write_timing().packet_gap_ms))
                        .await;
                }
            }
        }
        Err(last)
    }
}
