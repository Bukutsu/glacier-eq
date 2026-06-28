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
}
