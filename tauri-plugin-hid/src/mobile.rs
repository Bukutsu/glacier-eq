use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

use crate::error::Error;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_hid);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Hid<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("uk.redfern.tauri.plugin.hid", "HidPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_hid)?;
    Ok(Hid(handle))
}

/// Access to the hid APIs.
pub struct Hid<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Hid<R> {
    pub fn enumerate(&self) -> crate::Result<Vec<HidDeviceInfo>> {
        let result = self
            .0
            .run_mobile_plugin::<EnumerateResult>("enumerate", ())
            .map_err(Error::PluginInvoke)?;
        Ok(result.devices)
    }

    pub fn open(&self, path: &str) -> crate::Result<()> {
        self.0
            .run_mobile_plugin(
                "open",
                OpenArgs {
                    path: path.to_string(),
                },
            )
            .map_err(Error::PluginInvoke)
    }

    pub fn close(&self, path: &str) -> crate::Result<()> {
        self.0
            .run_mobile_plugin(
                "close",
                CloseArgs {
                    path: path.to_string(),
                },
            )
            .map_err(Error::PluginInvoke)
    }

    pub fn read(&self, path: &str, mut timeout: i32) -> crate::Result<Vec<u8>> {
        // For compatibility with HIDAPI (where -1 means blocking read and 0 means return immediately)
        if timeout == 0 {
            timeout = 1; // 1ms is closest to HIDAPI's non-blocking read
        } else if timeout < 0 {
            timeout = 0; // Wait indefinitely
        }

        let result = self
            .0
            .run_mobile_plugin::<ReadResult>(
                "read",
                ReadArgs {
                    path: path.to_string(),
                    timeout,
                },
            )
            .map_err(Error::PluginInvoke)?;
        // Convert signed bytes to unsigned bytes for Android
        let data: Vec<u8> = result.data.iter().map(|&byte| byte as u8).collect();
        Ok(data)
    }

    pub fn write(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        // Convert unsigned bytes to signed bytes for Android.
        // If the first byte (the HID Report ID) is 0, we strip it because devices
        // without report IDs expect the raw payload directly on the wire.
        // If the Report ID is non-zero, we KEEP it because the device's descriptors
        // declare a Report ID, meaning the device expects the Report ID as the first
        // byte of the packet on the wire. We truncate the total packet to 64 bytes
        // to fit the endpoint's maxPacketSize.
        let data: Vec<i8> = if !data.is_empty() {
            if data[0] == 0 {
                data[1..].iter().map(|&byte| byte as i8).collect()
            } else {
                let len = data.len().min(64);
                data[..len].iter().map(|&byte| byte as i8).collect()
            }
        } else {
            Vec::new()
        };

        self.0
            .run_mobile_plugin(
                "write",
                WriteArgs {
                    path: path.to_string(),
                    data: data,
                },
            )
            .map_err(Error::PluginInvoke)
    }
}
