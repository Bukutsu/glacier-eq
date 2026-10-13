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

    pub fn open(&self, path: &str, session_id: u64) -> crate::Result<()> {
        self.open_with_report_contract(path, session_id, None)
    }

    pub fn open_with_report_contract(
        &self,
        path: &str,
        session_id: u64,
        contract: Option<glacier_core::device::hid::ReportContract>,
    ) -> crate::Result<()> {
        let args = OpenArgs {
            path: path.to_string(),
            session_id,
            report_id: contract.map(|c| c.report_id),
            min_output_bytes: contract.map_or(0, |c| c.min_output_bytes),
            min_input_bytes: contract.map_or(0, |c| c.min_input_bytes),
        };
        #[cfg(target_os = "android")]
        {
            let result = self
                .0
                .run_mobile_plugin::<ReadResult>("open", args)
                .map_err(Error::PluginInvoke)?;
            if let Some(contract) = contract {
                let descriptor: Vec<u8> = result.data.iter().map(|byte| *byte as u8).collect();
                if let Err(message) = contract.validate(&descriptor) {
                    let _ = self.close(path, Some(session_id));
                    return Err(
                        std::io::Error::new(std::io::ErrorKind::InvalidData, message).into(),
                    );
                }
            }
            Ok(())
        }
        #[cfg(target_os = "ios")]
        {
            self.0
                .run_mobile_plugin("open", args)
                .map_err(Error::PluginInvoke)
        }
    }

    pub fn close(&self, path: &str, session_id: Option<u64>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin(
                "close",
                CloseArgs {
                    path: path.to_string(),
                    session_id,
                },
            )
            .map_err(Error::PluginInvoke)
    }

    pub fn read(&self, path: &str, mut timeout: i32) -> crate::Result<Vec<u8>> {
        // For compatibility with HIDAPI (where -1 means blocking read and 0 means return immediately)
        if timeout == 0 {
            timeout = 1; // 1ms is closest to HIDAPI's non-blocking read
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
        // HIDAPI includes the report ID as the first byte. Keep it separate so
        // Android can frame control and interrupt transfers correctly.
        let (report_id, payload) = split_report(data);
        let data = payload.iter().map(|&byte| byte as i8).collect();

        self.0
            .run_mobile_plugin(
                "write",
                WriteArgs {
                    path: path.to_string(),
                    report_id,
                    data,
                },
            )
            .map_err(Error::PluginInvoke)
    }
}
