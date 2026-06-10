// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

/// Timing configuration for reading data from the device.
#[derive(Debug, Clone)]
pub struct ReadTiming {
    pub post_version_ms: u64,
    pub filter_request_ms: u64,
    pub inter_filter_ms: u64,
    pub post_filter_read_ms: u64,
    pub post_global_gain_ms: u64,
    pub read_timeout_ms: u32,
    pub wake_delay_ms: u64,
    pub pull_retry_delay_ms: u64,
    pub verify_backoff_base_ms: u64,
}

impl Default for ReadTiming {
    fn default() -> Self {
        Self {
            post_version_ms: 50,
            filter_request_ms: 10,
            inter_filter_ms: 10,
            post_filter_read_ms: 40,
            post_global_gain_ms: 25,
            read_timeout_ms: 60,
            wake_delay_ms: 50,
            pull_retry_delay_ms: 100,
            verify_backoff_base_ms: 200,
        }
    }
}

/// Timing configuration for writing data to the device.
#[derive(Debug, Clone)]
pub struct WriteTiming {
    pub per_filter_ms: u64,
    pub flood_delay_ms: u64,
    pub batch_ms: u64,
    pub global_gain_ms: u64,
    /// Delay applied after each commit packet (pre-commit steps, temp-write, flash-eq).
    pub commit_step_ms: u64,
}

impl Default for WriteTiming {
    fn default() -> Self {
        Self {
            per_filter_ms: 80,
            flood_delay_ms: 5,
            batch_ms: 100,
            global_gain_ms: 50,
            commit_step_ms: 100,
        }
    }
}
