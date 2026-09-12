use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub(crate) mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::MaterialYou;
#[cfg(mobile)]
use mobile::MaterialYou;

#[allow(dead_code)]
pub fn material_you<R: Runtime, T: Manager<R>>(manager: &T) -> &MaterialYou<R> {
    manager.state::<MaterialYou<R>>().inner()
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("material-you")
        .invoke_handler(tauri::generate_handler![commands::get_dynamic_colors])
        .setup(|app, api| {
            #[cfg(mobile)]
            let material_you = mobile::init(app, api)?;
            #[cfg(desktop)]
            let material_you = desktop::init(app, api)?;
            app.manage(material_you);
            Ok(())
        })
        .build()
}
