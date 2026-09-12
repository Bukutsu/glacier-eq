use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

/// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MaterialYou<R>> {
    #[cfg(target_os = "android")]
    return api
        .register_android_plugin(
            "com.bukutsu.tauri.plugin.materialyou",
            "MaterialYouPlugin",
        )
        .map(MaterialYou)
        .map_err(crate::Error::PluginInvoke);
    #[cfg(not(target_os = "android"))]
    return Err(crate::Error::UnsupportedPlatform);
}

/// Access to the Material You APIs.
pub struct MaterialYou<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MaterialYou<R> {
    pub fn get_dynamic_colors(&self) -> crate::Result<DynamicColors> {
        self.0
            .run_mobile_plugin::<DynamicColors>("getDynamicColors", ())
            .map_err(crate::Error::PluginInvoke)
    }
}
