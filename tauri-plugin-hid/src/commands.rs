use tauri::{AppHandle, command, Runtime};

use crate::Result;
use crate::HidExt;

#[command]
pub(crate) async fn enumerate<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<crate::HidDeviceInfo>> {
    app.hid().enumerate()
}

#[command]
pub(crate) async fn open<R: Runtime>(
    app: AppHandle<R>,
    path: &str,
) -> Result<()> {
    app.hid().open(path)
}

#[command]
pub(crate) async fn close<R: Runtime>(
    app: AppHandle<R>,
    path: &str,
) -> Result<()> {
    // Call the close method
    app.hid().close(path)
}

#[command]
pub(crate) async fn write<R: Runtime>(
    app: AppHandle<R>,
    path: &str,
    data: Vec<u8>,
) -> Result<()> {
    app.hid().write(path, data.as_slice())
}

#[command]
pub(crate) async fn read<R: Runtime>(
    app: AppHandle<R>,
    path: &str,
    timeout: i32
) -> Result<Vec<u8>> {
    app.hid().read(path, timeout)
}