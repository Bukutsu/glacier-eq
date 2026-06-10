// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! EQ domain constants: frequency ranges, gain limits, Q-factor bounds, and ISO standard values.

pub const MAX_BAND_GAIN: f64 = 10.0;
pub const MIN_BAND_GAIN: f64 = -10.0;
pub const GAIN_STEP: f64 = 0.01;
pub const MAX_GLOBAL_GAIN: i8 = 6;
pub const MIN_GLOBAL_GAIN: i8 = -16;
pub const MIN_Q: f64 = 0.1;
pub const MAX_Q: f64 = 20.0;
pub const MIN_FREQ: u16 = 20;
pub const MAX_FREQ: u16 = 20000;
pub const NUM_BANDS: usize = 10;

pub const ISO_FREQUENCIES: [u16; 31] = [
    20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

pub const ISO_Q_VALUES: [f64; 10] = [0.1, 0.25, 0.5, 0.707, 1.0, 1.4, 2.0, 4.0, 8.0, 16.0];
