use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::marker::PhantomData;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<MaterialYou<R>> {
    Ok(MaterialYou(PhantomData))
}

/// Desktop stub: dynamic colors are only available on Android 12+.
pub struct MaterialYou<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> MaterialYou<R> {
    pub fn get_dynamic_colors(&self) -> crate::Result<DynamicColors> {
        Ok(DynamicColors {
            available: false,
            dark: false,
            palettes: HashMap::new(),
        })
    }
}
