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
        device_list: Mutex::new(HashMap::new()),
        open_devices: Mutex::new(HashMap::new()),
        _phantom: PhantomData,
    })
}

/// Access to the hid APIs.
pub struct Hid<R: Runtime> {
    hid_api: Mutex<HidApi>,
    device_list: Mutex<HashMap<String, hidapi::DeviceInfo>>, // Hashmap of devices using path as key. Updated on enumerate.
    open_devices: Mutex<HashMap<String, hidapi::HidDevice>>, // Currently open devices.
    _phantom: PhantomData<fn() -> R>,
}

impl<R: Runtime> Hid<R> {
    pub fn enumerate(&self) -> crate::Result<Vec<crate::HidDeviceInfo>> {
        let mut device_list = self.device_list.lock().unwrap();
        let mut hid_api = self.hid_api.lock().unwrap();

        device_list.clear();
        hid_api.refresh_devices()?;
        for device in hid_api.device_list() {
            device_list.insert(device.path().to_string_lossy().to_string(), device.clone());
        }

        Ok(device_list
            .values()
            .map(|device| crate::HidDeviceInfo {
                path: device.path().to_string_lossy().to_string(),
                product_id: device.product_id(),
                vendor_id: device.vendor_id(),
                manufacturer_string: device.manufacturer_string().map(str::to_owned),
                product_string: device.product_string().map(str::to_owned),
                serial_number: device.serial_number().map(str::to_owned),
                release_number: device.release_number(),
            })
            .collect())
    }

    pub fn open(&self, path: &str) -> crate::Result<()> {
        // Get a lock on the hid_api, device_list and open_devices mutex to ensure thread safety.
        // This will panic if the mutex is poisoned, which should not happen in normal operation.
        let hid_api = self.hid_api.lock().unwrap();
        let device_list = self.device_list.lock().unwrap();
        let mut open_devices = self.open_devices.lock().unwrap();
        // Attempt to open the device with by looking up path in the device_list HashMap.
        let device = device_list
            .get(path)
            .ok_or(crate::Error::HidDeviceNotFound)?;
        // Check if the device is already open by looking it up in the open_devices HashMap.
        if open_devices.contains_key(path) {
            return Err(crate::Error::HidDeviceAlreadyOpen);
        }
        // Open the device using the HidApi instance.
        // The HidDevice instance is automatically closed when it goes out of scope.
        let open_device = device.open_device(&hid_api)?;
        // Add the device to the open_devices HashMap.
        open_devices.insert(path.to_string(), open_device);
        Ok(())
    }

    pub fn close(&self, path: &str) -> crate::Result<()> {
        // Get a lock on the open_devices mutex to ensure thread safety.
        // This will panic if the mutex is poisoned, which should not happen in normal operation.
        let mut open_devices = self.open_devices.lock().unwrap();
        // Remove the device from the open_devices HashMap using the path as the key.
        // This will also close the device as the HidDevice is dropped.
        open_devices.remove(path);
        Ok(())
    }

    pub fn write(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        // Get a lock on the open_devices mutex to ensure thread safety.
        // This will panic if the mutex is poisoned, which should not happen in normal operation.
        let open_devices = self.open_devices.lock().unwrap();
        // Get device from the open_devices HashMap using the UUID as the key.
        // If the device is not found, return an error.
        let device = match open_devices.get(path) {
            Some(device) => device,
            None => return Err(crate::Error::HidDeviceNotFoundInOpenDevices),
        };
        // Write data to the device.
        // TODO: Consider closing the device if write fails (to avoid stale device in list).
        device.write(data)?;
        Ok(())
    }

    pub fn read(&self, path: &str, timeout: i32) -> crate::Result<Vec<u8>> {
        // Get a lock on the open_devices mutex to ensure thread safety.
        // This will panic if the mutex is poisoned, which should not happen in normal operation.
        let open_devices = self.open_devices.lock().unwrap();
        // Get device from the open_devices HashMap using the UUID as the key.
        // If the device is not found, return an error.
        let device = match open_devices.get(path) {
            Some(device) => device,
            None => return Err(crate::Error::HidDeviceNotFoundInOpenDevices),
        };
        let mut buffer = vec![0; 64];
        // Read data from the device into the buffer.
        // The read method will block until data is available or an error occurs.
        // TODO: Consider closing the device if read fails (to avoid stale device in list).
        let len = device.read_timeout(&mut buffer, timeout)?;
        buffer.truncate(len);
        // Always return the buffer, even if empty
        Ok(buffer)
    }
}
