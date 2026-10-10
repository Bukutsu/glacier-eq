use tauri::{AppHandle, Runtime, State};

use crate::{
    models::{DynamicColors, SystemBarAppearance},
    MaterialYou, Result,
};

#[tauri::command]
pub(crate) async fn set_system_bar_appearance<R: Runtime>(
    _app: AppHandle<R>,
    dark: bool,
    material_you: State<'_, MaterialYou<R>>,
) -> Result<()> {
    material_you.set_system_bar_appearance(SystemBarAppearance { dark })
}

#[tauri::command]
pub(crate) async fn get_dynamic_colors<R: Runtime>(
    _app: AppHandle<R>,
    material_you: State<'_, MaterialYou<R>>,
) -> Result<DynamicColors> {
    material_you.get_dynamic_colors()
}
