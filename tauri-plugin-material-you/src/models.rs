use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Material You tonal palettes read from the Android system.
/// Each family (`accent1`, `accent2`, `accent3`, `neutral1`, `neutral2`)
/// maps tone (0-1000) to `#RRGGBB`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicColors {
    pub available: bool,
    #[serde(default)]
    pub dark: bool,
    #[serde(default)]
    pub palettes: HashMap<String, HashMap<String, String>>,
}
