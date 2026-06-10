// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! EQ domain: filters, presets, and standard EQ parameters.
//!
//! UI-agnostic — usable from Tauri, CLI, or headless services.

pub mod constants;
pub mod filter;

pub use constants::*;
pub use filter::{snap_freq_to_iso, snap_gain_step, snap_q_to_iso, Filter, FilterType, PEQData};
