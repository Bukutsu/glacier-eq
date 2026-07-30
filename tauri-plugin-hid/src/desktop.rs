use hidapi::HidApi;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::{Arc, Mutex};
use tauri::{plugin::PluginApi, AppHandle, Runtime};

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
            })
            .collect();

        Ok(devices)
    }

    pub fn open(&self, path: &str) -> crate::Result<()> {
        let hid_api = self.hid_api.lock().unwrap_or_else(|p| p.into_inner());
        let mut open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());

        if open_devices.contains_key(path) {
            return Err(crate::Error::HidDeviceAlreadyOpen);
        }

        let c_path = std::ffi::CString::new(path).map_err(|_| crate::Error::HidDeviceNotFound)?;
        let open_device = hid_api.open_path(&c_path)?;
        open_devices.insert(path.to_string(), Arc::new(Mutex::new(open_device)));
        Ok(())
    }

    pub fn close(&self, path: &str) -> crate::Result<()> {
        let mut open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
        open_devices.remove(path);
        Ok(())
    }

    pub fn write(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        let device = {
            let open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
            open_devices
                .get(path)
                .cloned()
                .ok_or(crate::Error::HidDeviceNotFoundInOpenDevices)?
        };

        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        device.write(data)?;
        Ok(())
    }

    pub fn read(&self, path: &str, timeout: i32) -> crate::Result<Vec<u8>> {
        let device = {
            let open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
            open_devices
                .get(path)
                .cloned()
                .ok_or(crate::Error::HidDeviceNotFoundInOpenDevices)?
        };
        let mut buffer = vec![0; 1024];
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        let len = device.read_timeout(&mut buffer, timeout)?;
        buffer.truncate(len);
        Ok(buffer)
    }
}
