use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceInfo {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub release_number: u16,
    pub manufacturer_string: Option<String>,
    pub product_string: Option<String>,
}

// Models for Android HID API

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateResult {
    pub devices: Vec<HidDeviceInfo>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenArgs {
    pub path: String,
    #[serde(default)]
    pub session_id: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseArgs {
    pub path: String,
    #[serde(default)]
    pub session_id: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArgs {
    pub path: String,
    pub timeout: i32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub data: Vec<i8>, // signed byte to match Android
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteArgs {
    pub path: String,
    pub report_id: u8,
    pub data: Vec<i8>, // report payload, excluding the report ID
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOnAttach {
    pub enabled: bool,
}

#[cfg(mobile)]
pub(crate) fn split_report(data: &[u8]) -> (u8, &[u8]) {
    let report_id = data.first().copied().unwrap_or(0);
    let payload = data.get(1..).unwrap_or_default();
    (report_id, payload)
}
