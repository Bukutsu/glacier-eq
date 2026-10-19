// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! In-app update eligibility.
//!
//! The updater plugin can replace the running program only for builds that
//! know how they were packaged: Tauri patches the bundle type into the binary
//! when it makes an AppImage, NSIS, or MSI package, and macOS is always an
//! app bundle. Anything else (a distro package, a portable Windows zip, a
//! `cargo run` build, an Android APK) has no installer the plugin can drive,
//! so the plugin is not even registered there and the UI shows the update
//! card greyed out with the reason.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct UpdateSupport {
    pub supported: bool,
    /// Stable code the UI maps to a message: `systemPackage`, `unpackaged`,
    /// or `mobile`. `None` when updates are supported.
    pub reason: Option<&'static str>,
}

#[cfg(not(mobile))]
const SUPPORTED: UpdateSupport = UpdateSupport {
    supported: true,
    reason: None,
};

const fn unsupported(reason: &'static str) -> UpdateSupport {
    UpdateSupport {
        supported: false,
        reason: Some(reason),
    }
}

#[cfg(not(mobile))]
fn classify(bundle: Option<tauri::utils::config::BundleType>, debug: bool) -> UpdateSupport {
    use tauri::utils::config::BundleType;
    match bundle {
        // macOS reports an app bundle even for `tauri dev`; a debug build
        // is never something the release feed should overwrite.
        _ if debug => unsupported("unpackaged"),
        Some(BundleType::AppImage | BundleType::Nsis | BundleType::Msi | BundleType::App) => {
            SUPPORTED
        }
        Some(BundleType::Deb | BundleType::Rpm) => unsupported("systemPackage"),
        _ => unsupported("unpackaged"),
    }
}

#[cfg(not(mobile))]
pub fn support() -> UpdateSupport {
    classify(
        tauri::utils::platform::bundle_type(),
        cfg!(debug_assertions),
    )
}

#[cfg(mobile)]
pub fn support() -> UpdateSupport {
    unsupported("mobile")
}

#[tauri::command]
pub fn get_update_support() -> UpdateSupport {
    support()
}

/// Relaunch after the frontend has installed an update. Refuses on builds
/// that cannot update so the command is not a general restart hook.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    if !support().supported {
        return Err("This build does not support in-app updates".into());
    }
    #[cfg(not(mobile))]
    app.restart();
    #[cfg(mobile)]
    {
        let _ = app;
        Err("Restart is not available on this platform".into())
    }
}

#[cfg(all(test, not(mobile)))]
mod tests {
    use super::*;
    use tauri::utils::config::BundleType;

    #[test]
    fn self_contained_bundles_are_supported() {
        for bundle in [
            BundleType::AppImage,
            BundleType::Nsis,
            BundleType::Msi,
            BundleType::App,
        ] {
            assert_eq!(classify(Some(bundle), false), SUPPORTED);
        }
    }

    #[test]
    fn system_packages_defer_to_the_package_manager() {
        for bundle in [BundleType::Deb, BundleType::Rpm] {
            assert_eq!(classify(Some(bundle), false), unsupported("systemPackage"));
        }
    }

    #[test]
    fn unpackaged_and_debug_builds_are_unsupported() {
        assert_eq!(classify(None, false), unsupported("unpackaged"));
        assert_eq!(
            classify(Some(BundleType::App), true),
            unsupported("unpackaged")
        );
    }
}
