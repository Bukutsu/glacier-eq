// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

/// Timing configuration for writing data to the device.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WriteTiming {
    pub per_filter_ms: u64,
    pub batch_ms: u64,
    pub global_gain_ms: u64,
    /// Delay applied after each commit packet (pre-commit steps, temp-write, flash-eq).
    pub commit_step_ms: u64,
    /// Delay between successive read requests during a pull (flood control).
    pub flood_delay_ms: u64,
    /// Delay after the global-gain read, before starting the band read loop.
    pub post_gain_read_ms: u64,
}

impl Default for WriteTiming {
    fn default() -> Self {
        Self {
            per_filter_ms: 80,
            batch_ms: 100,
            global_gain_ms: 50,
            commit_step_ms: 100,
            flood_delay_ms: 5,
            post_gain_read_ms: 0,
        }
    }
}
