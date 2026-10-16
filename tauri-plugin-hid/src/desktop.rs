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

fn hex_bytes(data: &[u8]) -> String {
    data.iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn output_report_failure(
    error: &str,
    data: &[u8],
    interface: &str,
    descriptor: Result<&[u8], String>,
) -> String {
    let id = data
        .first()
        .map_or_else(|| "missing".to_string(), |id| format!("0x{id:02X}"));
    let descriptor = match descriptor {
        Ok([]) => "empty".to_string(),
        Ok(bytes) => hex_bytes(bytes),
        Err(error) => format!("unavailable: {error}"),
    };
    format!(
        "{error}; Output report ID={id}, buffer={} bytes, prefix=[{}]; \
         HID interface={interface}; HIDAPI report descriptor=[{descriptor}]",
        data.len(),
        hex_bytes(&data[..data.len().min(8)]),
    )
}

/// Keep the attempted framing and descriptor together so report type/ID
/// mismatches can be diagnosed without guessing commands.
fn describe_write_failure(device: &hidapi::HidDevice, error: &str, data: &[u8]) -> crate::Error {
    let interface = device.get_device_info().map_or_else(
        |error| format!("unavailable: {error}"),
        |info| {
            format!(
                "number={}, usage_page=0x{:04X}, usage=0x{:04X}",
                info.interface_number(),
                info.usage_page(),
                info.usage()
            )
        },
    );
    let mut descriptor = vec![0; hidapi::MAX_REPORT_DESCRIPTOR_SIZE];
    let result = device
        .get_report_descriptor(&mut descriptor)
        .map(|length| &descriptor[..length])
        .map_err(|error| error.to_string());
    hidapi::HidError::HidApiError {
        message: output_report_failure(error, data, &interface, result),
    }
    .into()
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
            })
            .collect();

        Ok(devices)
    }

    pub fn open(&self, path: &str, _session_id: u64) -> crate::Result<()> {
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

    pub fn close(&self, path: &str, _session_id: Option<u64>) -> crate::Result<()> {
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
        // Windows WriteFile returns 0x57 when the report ID or length does not
        // match the opened interface; attach the descriptor so a remote tester
        // can send back enough to diagnose it.
        let written = device
            .write(data)
            .map_err(|error| describe_write_failure(&device, &error.to_string(), data))?;
        ensure_complete_write(data.len(), written)
    }

    /// Send the report ID and padded payload using HID SET_REPORT.
    pub fn send_output_report(&self, path: &str, data: &[u8]) -> crate::Result<()> {
        let device = {
            let open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
            open_devices
                .get(path)
                .cloned()
                .ok_or(crate::Error::HidDeviceNotFoundInOpenDevices)?
        };
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        // Read-only metadata on failure, not a Feature-report fallback.
        device
            .send_output_report(data)
            .map_err(|error| describe_write_failure(&device, &error.to_string(), data))
    }

    /// Input GET_REPORT for original Dawn Pro's nine-byte reply.
    /// Abdul Mateen's Windows-tested DawnPro._read does not use ReadFile first:
    /// https://github.com/RetR0-hex/moondrop-dawn-pro-gui/blob/69f95f669377646da1e9ba931bec9a5dc9b5d40c/moondrop/device.py
    pub fn get_dawn_pro_input_report(&self, path: &str) -> crate::Result<Vec<u8>> {
        let device = {
            let open_devices = self.open_devices.lock().unwrap_or_else(|p| p.into_inner());
            open_devices
                .get(path)
                .cloned()
                .ok_or(crate::Error::HidDeviceNotFoundInOpenDevices)?
        };
        let device = device.lock().unwrap_or_else(|p| p.into_inner());
        let mut report = [0; 9];
        match device.get_input_report(&mut report) {
            Ok(length) => Ok(report[..length].to_vec()),
            Err(error) => {
                // Same interrupt fallback as the reference, preserving ID 0.
                let length = device.read_timeout(&mut report[1..], 500)?;
                if length == 0 {
                    return Err(error.into());
                }
                Ok(report[..length + 1].to_vec())
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_output_reports_include_framing_and_descriptor() {
        let mut report = vec![0; 64];
        report[..3].copy_from_slice(&[0x4B, 0x80, 0x23]);
        let error = output_report_failure(
            "HidD_SetOutputReport",
            &report,
            "number=0",
            Ok(&[0x85, 0x01, 0x75, 0x08]),
        );
        assert!(error.contains("HidD_SetOutputReport"));
        assert!(error.contains("Output report ID=0x4B, buffer=64 bytes"));
        assert!(error.contains("prefix=[4B 80 23 00 00 00 00 00]"));
        assert!(error.contains("HID interface=number=0"));
        assert!(error.contains("HIDAPI report descriptor=[85 01 75 08]"));
    }

    #[test]
    fn metadata_failure_preserves_the_original_output_error() {
        let error = output_report_failure(
            "HidD_SetOutputReport",
            &[],
            "unavailable",
            Err("device disconnected".to_string()),
        );
        assert!(error.starts_with("HidD_SetOutputReport"));
        assert!(error.contains("ID=missing, buffer=0 bytes"));
        assert!(error.contains("descriptor=[unavailable: device disconnected]"));
        assert!(output_report_failure("failure", &[0], "unknown", Ok(&[]))
            .contains("descriptor=[empty]"));
    }

    #[test]
    fn accepts_complete_and_padded_hid_writes() {
        assert!(ensure_complete_write(4, 4).is_ok());
        assert!(ensure_complete_write(4, 64).is_ok());
    }

    #[test]
    fn rejects_short_hid_writes() {
        let error = ensure_complete_write(64, 12).unwrap_err().to_string();
        assert!(error.contains("expected at least 64 bytes"), "{error}");
        assert!(error.contains("actual 12"), "{error}");
    }
}
