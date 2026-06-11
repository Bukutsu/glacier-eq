use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Hid;
#[cfg(mobile)]
use mobile::Hid;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the hid APIs.
pub trait HidExt<R: Runtime> {
    fn hid(&self) -> &Hid<R>;
}

impl<R: Runtime, T: Manager<R>> crate::HidExt<R> for T {
    fn hid(&self) -> &Hid<R> {
        self.state::<Hid<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hid")
        .invoke_handler(tauri::generate_handler![
            commands::enumerate,
            commands::open,
            commands::close,
            commands::write,
            commands::read,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let hid = mobile::init(app, api)?;
            #[cfg(desktop)]
            let hid = desktop::init(app, api)?;
            app.manage(hid);
            Ok(())
        })
        .build()
}
