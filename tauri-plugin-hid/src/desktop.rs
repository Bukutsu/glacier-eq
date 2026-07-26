use hidapi::HidApi;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Mutex;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Hid<R>> {
    Ok(Hid {
        hid_api: Mutex::new(HidApi::new().expect("Could not create HidApi instance")),
        open_devices: Mutex::new(HashMap::new()),
        _phantom: PhantomData,
    })
}

/// Access to the hid APIs.
pub struct Hid<R: Runtime> {
    hid_api: Mutex<HidApi>,
    open_devices: Mutex<HashMap<String, hidapi::HidDevice>>,
    _phantom: PhantomData<fn() -> R>,
}

impl<R: Runtime> Hid<R> {
    pub fn enumerate(&self) -> crate::Result<Vec<crate::HidDeviceInfo>> {
        let mut hid_api = self.hid_api.lock().unwrap();

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
        let hid_api = self.hid_api.lock().unwrap();
        let mut open_devices = self.open_devices.lock().unwrap();

        if open_devices.contains_key(path) {
            return Err(crate::Error::HidDeviceAlreadyOpen);
        }

        let c_path = std::ffi::CString::new(path).map_err(|_| crate::Error::HidDeviceNotFound)?;
        let open_device = hid_api.open_path(&c_path)?;
        open_devices.insert(path.to_string(), open_device);
        Ok(())
    }

    pub fn close(&self, path: &str) -> crate::Result<()> {
        let mut open_devices = self.open_devices.lock().unwrap();
        open_devices.remove(path);
        Ok(())
    }

    pub fn write(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        let open_devices = self.open_devices.lock().unwrap();
        let device = match open_devices.get(path) {
            Some(device) => device,
            None => return Err(crate::Error::HidDeviceNotFoundInOpenDevices),
        };

        device.write(data)?;
        Ok(())
    }

    pub fn read(&self, path: &str, timeout: i32) -> crate::Result<Vec<u8>> {
        let open_devices = self.open_devices.lock().unwrap();
        let device = match open_devices.get(path) {
            Some(device) => device,
            None => return Err(crate::Error::HidDeviceNotFoundInOpenDevices),
        };
        let mut buffer = vec![0; 1024];
        let len = device.read_timeout(&mut buffer, timeout)?;
        buffer.truncate(len);
        Ok(buffer)
    }
}
