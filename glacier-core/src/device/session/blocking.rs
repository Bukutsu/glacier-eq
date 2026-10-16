// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Native HID adapters: synchronous I/O lifted into the asynchronous session.
//! Run these on the caller's blocking worker, never on a UI or browser thread.

use super::{DeviceIo, DeviceSession, ProgressCallback};
use crate::device::DeviceProfile;
use std::future::Future;
use std::task::{Context, Poll, Waker};

pub trait BlockingDeviceIo {
    fn write(&mut self, data: &[u8]) -> Result<(), String>;
    /// Empty bytes mean timeout; errors mean transport failure.
    fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String>;
    fn reads_include_report_id(&self) -> bool {
        false
    }
    fn sleep_ms(&mut self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

pub struct BlockingIo<'a>(pub &'a mut dyn BlockingDeviceIo);

impl DeviceIo for BlockingIo<'_> {
    async fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.0.write(data)
    }
    async fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String> {
        self.0.read(timeout_ms)
    }
    fn reads_include_report_id(&self) -> bool {
        self.0.reads_include_report_id()
    }
    async fn sleep_ms(&mut self, ms: u64) {
        self.0.sleep_ms(ms);
    }
}

/// Drive a session backed by BlockingIo. Its I/O futures never suspend.
/// A pending future is a programming error, rather than an accidental spin loop.
pub fn block_on<T>(future: impl Future<Output = T>) -> T {
    match std::pin::pin!(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("blocking session suspended: use an async executor for async I/O"),
    }
}

impl<'a> DeviceSession<'a, BlockingIo<'a>> {
    #[cfg(test)]
    pub(crate) fn new(io: &'a mut dyn BlockingDeviceIo, profile: &'static DeviceProfile) -> Self {
        Self::from_io(BlockingIo(io), profile, None, 0)
    }

    pub fn with_progress(
        io: &'a mut dyn BlockingDeviceIo,
        profile: &'static DeviceProfile,
        progress: &'a mut ProgressCallback<'a>,
    ) -> Self {
        Self::with_progress_and_nonce(io, profile, progress, 0)
    }

    pub fn with_progress_and_nonce(
        io: &'a mut dyn BlockingDeviceIo,
        profile: &'static DeviceProfile,
        progress: &'a mut ProgressCallback<'a>,
        initial_nonce: u8,
    ) -> Self {
        Self::from_io(BlockingIo(io), profile, Some(progress), initial_nonce)
    }
}
