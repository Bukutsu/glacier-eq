// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Linux desktop integration: ensures application icons and desktop entries
//! are registered so Wayland/X11 compositors (KDE Plasma, GNOME) display the
//! application icon properly in taskbars during `tauri dev` and binary releases.

#[cfg(target_os = "linux")]
use gtk::prelude::*;

#[cfg(target_os = "linux")]
pub fn ensure_linux_desktop_icon() {
    let home = match std::env::var_os("HOME") {
        Some(h) => std::path::PathBuf::from(h),
        None => return,
    };
    let data_home = match std::env::var_os("XDG_DATA_HOME") {
        Some(d) => std::path::PathBuf::from(d),
        None => home.join(".local").join("share"),
    };

    let icons_dir = data_home.join("icons");
    let apps_dir = data_home.join("applications");

    let _ = std::fs::create_dir_all(&icons_dir);
    let _ = std::fs::create_dir_all(&apps_dir);

    // Embedded icons from the repository
    const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
    const ICON_128: &[u8] = include_bytes!("../icons/128x128.png");
    const ICON_64: &[u8] = include_bytes!("../icons/64x64.png");
    const ICON_32: &[u8] = include_bytes!("../icons/32x32.png");
    const ICON_SVG: &[u8] = include_bytes!("../../public/glacier-eq.svg");

    let icon_png_path = icons_dir.join("glacier-eq.png");
    let icon_app_png_path = icons_dir.join("com.bukutsu.glaciereq.png");
    let icon_svg_path = icons_dir.join("glacier-eq.svg");

    // Write icons to ~/.local/share/icons/ if missing or size differs
    if !icon_png_path.exists()
        || std::fs::metadata(&icon_png_path).map(|m| m.len()).unwrap_or(0) != ICON_PNG.len() as u64
    {
        let _ = std::fs::write(&icon_png_path, ICON_PNG);
    }
    if !icon_app_png_path.exists() {
        let _ = std::fs::write(&icon_app_png_path, ICON_PNG);
    }
    if !icon_svg_path.exists() {
        let _ = std::fs::write(&icon_svg_path, ICON_SVG);
    }

    // Also populate standard hicolor theme hierarchy if accessible
    for (sub, bytes) in [
        ("hicolor/512x512/apps", ICON_PNG),
        ("hicolor/128x128/apps", ICON_128),
        ("hicolor/64x64/apps", ICON_64),
        ("hicolor/32x32/apps", ICON_32),
    ] {
        let dir = icons_dir.join(sub);
        if std::fs::create_dir_all(&dir).is_ok() {
            let p1 = dir.join("glacier-eq.png");
            let p2 = dir.join("com.bukutsu.glaciereq.png");
            if !p1.exists() {
                let _ = std::fs::write(&p1, bytes);
            }
            if !p2.exists() {
                let _ = std::fs::write(&p2, bytes);
            }
        }
    }

    let current_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "glacier-eq".into());

    let desktop_content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Glacier EQ\n\
         GenericName=Parametric Equalizer\n\
         Comment=Cross-platform parametric EQ editor for USB DACs\n\
         Exec=\"{}\"\n\
         Icon={}\n\
         Terminal=false\n\
         Categories=AudioVideo;Audio;\n\
         StartupWMClass=glacier-eq\n",
        current_exe,
        icon_png_path.display()
    );

    let desktop_app_content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Glacier EQ\n\
         GenericName=Parametric Equalizer\n\
         Comment=Cross-platform parametric EQ editor for USB DACs\n\
         Exec=\"{}\"\n\
         Icon={}\n\
         Terminal=false\n\
         Categories=AudioVideo;Audio;\n\
         StartupWMClass=com.bukutsu.glaciereq\n",
        current_exe,
        icon_png_path.display()
    );

    let _ = std::fs::write(apps_dir.join("glacier-eq.desktop"), &desktop_content);
    let _ = std::fs::write(apps_dir.join("com.bukutsu.glaciereq.desktop"), &desktop_app_content);

    // Refresh GTK's icon search path and default icon if GTK is initialized
    if gtk::is_initialized() {
        if let Some(theme) = gtk::IconTheme::default() {
            theme.append_search_path(&icons_dir);
            let _ = theme.rescan_if_needed();
        }
        gtk::Window::set_default_icon_name("glacier-eq");
        let _ = gtk::Window::set_default_icon_from_file(&icon_png_path);
    }

    // Trigger desktop database / sycoca refresh if utilities are present
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let _ = std::process::Command::new("kbuildsycoca6")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let _ = std::process::Command::new("kbuildsycoca5")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_linux_desktop_icon_creates_files() {
        ensure_linux_desktop_icon();
        if let Some(home) = std::env::var_os("HOME") {
            let base = std::path::PathBuf::from(home).join(".local").join("share");
            let icon = base.join("icons").join("glacier-eq.png");
            let desktop = base.join("applications").join("glacier-eq.desktop");
            assert!(icon.exists(), "glacier-eq.png should be created");
            assert!(desktop.exists(), "glacier-eq.desktop should be created");
        }
    }
}
