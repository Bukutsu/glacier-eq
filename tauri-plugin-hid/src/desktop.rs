use hidapi::HidApi;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::{Arc, Mutex};
use tauri::{plugin::PluginApi, AppHandle, Runtime};

fn ensure_complete_write(expected: usize, actual: usize) -> crate::Result<()> {
    // Windows pads short payloads to the device's output report length and
    // reports the padded length. Only a result shorter than our payload is a
    // partial write.
    if actual >= expected {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::WriteZero,
            format!("Short HID write: expected at least {expected} bytes, actual {actual}"),
        )
        .into())
    }
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Hid<R>> {
    let hid_api = HidApi::new()?;
    Ok(Hid {
        hid_api: Mutex::new(hid_api),
        open_devices: Mutex::new(HashMap::new()),
        _phantom: PhantomData,
    })
}

/// Access to the hid APIs.
pub struct Hid<R: Runtime> {
    hid_api: Mutex<HidApi>,
    open_devices: Mutex<HashMap<String, Arc<Mutex<hidapi::HidDevice>>>>,
    _phantom: PhantomData<fn() -> R>,
}

impl<R: Runtime> Hid<R> {
    pub fn enumerate(&self) -> crate::Result<Vec<crate::HidDeviceInfo>> {
        let mut hid_api = self.hid_api.lock().unwrap_or_else(|p| p.into_inner());

        hid_api.refresh_devices()?;
        let devices = hid_api
            .device_list()
            .map(|device| crate::HidDeviceInfo {
                path: device.path().to_string_lossy().to_string(),
                product_id: device.product_id(),
                vendor_id: device.vendor_id(),
                manufacturer_string: device.manufacturer_string().map(str::to_owned),
                product_string: device.product_string().map(str::to_owned),
                serial_number: device.serial_number().map(str::to_owned),
                release_number: device.release_number(),
                interface_number: Some(device.interface_number()),
                usage_page: Some(device.usage_page()),
                usage: Some(device.usage()),
            })
            .collect();

        Ok(devices)
    }

    pub fn open(&self, path: &str, session_id: u64) -> crate::Result<()> {
        self.open_with_report_contract(path, session_id, None)
    }

    pub fn open_with_report_contract(
        &self,
        path: &str,
        _session_id: u64,
        contract: Option<glacier_core::device::hid::ReportContract>,
    ) -> crate::Result<()> {
        let hid_api = self.hid_api.lock().unwrap_or_else(|p| p.into_inner());
        let mut open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());

        if open_devices.contains_key(path) {
            return Err(crate::Error::HidDeviceAlreadyOpen);
        }

        let c_path = std::ffi::CString::new(path).map_err(|_| crate::Error::HidDeviceNotFound)?;
        let open_device = hid_api.open_path(&c_path)?;
        if let Some(contract) = contract {
            let mut descriptor = vec![0; hidapi::MAX_REPORT_DESCRIPTOR_SIZE];
            let length = open_device.get_report_descriptor(&mut descriptor)?;
            contract
                .validate(&descriptor[..length])
                .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidData, message))?;
        }
        open_devices.insert(path.to_string(), Arc::new(Mutex::new(open_device)));
        Ok(())
    }

    /// Inspect a collection without installing it as an active transport.
    pub fn report_descriptor(&self, path: &str) -> crate::Result<Vec<u8>> {
        let hid_api = self.hid_api.lock().unwrap_or_else(|p| p.into_inner());
        let c_path = std::ffi::CString::new(path).map_err(|_| crate::Error::HidDeviceNotFound)?;
        let device = hid_api.open_path(&c_path)?;
        let mut descriptor = vec![0; hidapi::MAX_REPORT_DESCRIPTOR_SIZE];
        let length = device.get_report_descriptor(&mut descriptor)?;
        descriptor.truncate(length);
        Ok(descriptor)
    }

    pub fn close(&self, path: &str, _session_id: Option<u64>) -> crate::Result<()> {
        let mut open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
        open_devices.remove(path);
        Ok(())
    }

    fn device(&self, path: &str) -> crate::Result<Arc<Mutex<hidapi::HidDevice>>> {
        let open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
        open_devices
            .get(path)
            .cloned()
            .ok_or(crate::Error::HidDeviceNotFoundInOpenDevices)
    }

    pub fn write(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        let device = self.device(path)?;
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        let written = device.write(data)?;
        ensure_complete_write(data.len(), written)
    }

    /// Sends an output report over the control endpoint (HID SET_REPORT).
    /// The caller supplies the report ID followed by the full padded payload.
    pub fn send_output_report(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        let device = self.device(path)?;
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        device.send_output_report(data)?;
        Ok(())
    }

    pub fn read(&self, path: &str, timeout: i32) -> crate::Result<Vec<u8>> {
        let device = self.device(path)?;
        let mut buffer = vec![0; 1024];
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        let len = device.read_timeout(&mut buffer, timeout)?;
        buffer.truncate(len);
        Ok(buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_complete_and_padded_hid_writes() {
        assert!(ensure_complete_write(4, 4).is_ok());
        assert!(ensure_complete_write(4, 64).is_ok());
    }

    #[test]
    fn rejects_short_hid_writes() {
        // Never mask the 64 -> 8 result from #46 as a successful write.
        assert!(ensure_complete_write(64, 8).is_err());
        let error = ensure_complete_write(64, 12).unwrap_err().to_string();
        assert!(error.contains("expected at least 64 bytes"), "{error}");
        assert!(error.contains("actual 12"), "{error}");
    }
}
