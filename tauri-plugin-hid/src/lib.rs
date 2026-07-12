use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Hid;
#[cfg(mobile)]
use mobile::Hid;

pub fn hid<R: Runtime, T: Manager<R>>(manager: &T) -> &Hid<R> {
    manager.state::<Hid<R>>().inner()
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hid")
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
