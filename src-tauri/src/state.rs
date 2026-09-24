// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

#[derive(Debug, Clone)]
pub struct ConnectedDevice {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub profile_name: String,
}

#[derive(Debug, Default)]
pub struct DeviceState {
    pub connected: Option<ConnectedDevice>,
    /// Monotonic seed for filter-response nonces across short-lived Tauri
    /// command sessions. The device protocol carries only an 8-bit nonce, so
    /// reusing one for every command could match a delayed response.
    pub next_nonce: u8,
}

#[derive(Default)]
pub struct DeviceSessionLock(pub std::sync::Arc<tauri::async_runtime::Mutex<()>>);
