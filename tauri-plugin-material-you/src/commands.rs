use tauri::{AppHandle, Runtime, State};

use crate::{models::DynamicColors, MaterialYou, Result};

#[tauri::command]
pub(crate) async fn get_dynamic_colors<R: Runtime>(
    _app: AppHandle<R>,
    material_you: State<'_, MaterialYou<R>>,
) -> Result<DynamicColors> {
    material_you.get_dynamic_colors()
}
