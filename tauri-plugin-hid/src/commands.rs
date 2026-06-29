use tauri::{command, AppHandle, Runtime};

use crate::Result;

#[command]
pub(crate) async fn enumerate<R: Runtime>(app: AppHandle<R>) -> Result<Vec<crate::HidDeviceInfo>> {
    crate::hid(&app).enumerate()
}

#[command]
pub(crate) async fn open<R: Runtime>(app: AppHandle<R>, path: &str) -> Result<()> {
    crate::hid(&app).open(path)
}

#[command]
pub(crate) async fn close<R: Runtime>(app: AppHandle<R>, path: &str) -> Result<()> {
    crate::hid(&app).close(path)
}

#[command]
pub(crate) async fn write<R: Runtime>(app: AppHandle<R>, path: &str, data: Vec<u8>) -> Result<()> {
    crate::hid(&app).write(path, data.as_slice())
}

#[command]
pub(crate) async fn read<R: Runtime>(
    app: AppHandle<R>,
    path: &str,
    timeout: i32,
) -> Result<Vec<u8>> {
    crate::hid(&app).read(path, timeout)
}
