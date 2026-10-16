// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! HID transport seam: the `DeviceIo` trait and the session's send/drain/read helpers.

use super::DeviceSession;
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
    ) -> Result<Vec<u8>, String> {
        let protocol = self.protocol();
        for attempt in 1..=attempts {
            let bytes =
                self.io.read(60).await.map_err(|error| {
                    format!("{label} read failed on attempt {attempt}: {error}")
                })?;
            if bytes.is_empty() {
                continue;
            }
            let data = if self.io.reads_include_report_id() {
                match protocol.unframe_packet(&bytes) {
                    Ok(data) => data,
                    Err(_) => continue,
                }
            } else {
                bytes.as_slice()
            };
            if matches(data) {
                return Ok(data.to_vec());
            }
        }
        Err(format!("{label} read timeout"))
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
        let framed = packet.framed();
        let mut last = "Write failed".to_string();
        for _ in 0..WRITE_ATTEMPTS {
            match self.io.write(&framed).await {
                Ok(()) => return Ok(()),
                Err(error) => {
                    last = error;
                    self.io.sleep_ms(50).await;
                }
            }
        }
        Err(last)
    }
}

#[cfg(test)]
pub(crate) mod fake {
    use super::super::BlockingDeviceIo;
    use std::collections::VecDeque;

    #[derive(Debug, PartialEq)]
    pub(crate) enum IoEvent {
        Write(u8),
        Read,
        Sleep(u64),
    }

    #[derive(Default)]
    pub(crate) struct FakeIo {
        pub(crate) reads: VecDeque<Vec<u8>>,
        pub(crate) writes: Vec<Vec<u8>>,
        pub(crate) events: Vec<IoEvent>,
        pub(crate) read_error: Option<String>,
        pub(crate) read_errors: VecDeque<Option<String>>,
        pub(crate) read_error_until: Option<(usize, usize, String)>,
        pub(crate) read_calls: usize,
        pub(crate) write_calls: usize,
        pub(crate) failing_write_calls: VecDeque<usize>,
    }

    impl BlockingDeviceIo for FakeIo {
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.write_calls += 1;
            self.writes.push(data.to_vec());
            self.events
                .push(IoEvent::Write(data.get(2).copied().unwrap_or_default()));
            if self.failing_write_calls.front() == Some(&self.write_calls) {
                self.failing_write_calls.pop_front();
                Err("simulated write failure".into())
            } else {
                Ok(())
            }
        }
        fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
            self.events.push(IoEvent::Read);
            self.read_calls += 1;
            if let Some((first, last, error)) = &self.read_error_until {
                if self.read_calls >= *first && self.read_calls <= *last {
                    return Err(error.clone());
                }
            }
            if let Some(error) = &self.read_error {
                return Err(error.clone());
            }
            if let Some(bytes) = self.reads.pop_front() {
                return Ok(bytes);
            }
            if let Some(Some(error)) = self.read_errors.pop_front() {
                return Err(error);
            }
            Ok(Vec::new())
        }
        fn sleep_ms(&mut self, ms: u64) {
            self.events.push(IoEvent::Sleep(ms));
        }
    }
}
