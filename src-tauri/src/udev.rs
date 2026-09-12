// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! One-shot udev rules installer for Linux.
//!
//! Desktop Linux locks USB HID devices behind root by default, so connecting
//! a DAC otherwise falls back to a per-connect polkit prompt through the
//! `--hid-helper`. This module installs (and removes) the single bundled
//! rules file that grants the active-seat user (`uaccess`) access to the
//! supported DAC USB IDs. Elevation happens through one `pkexec` prompt per
//! install/remove; there is no daemon and nothing else on the system changes.

use serde::Serialize;
#[cfg(target_os = "linux")]
use std::path::PathBuf;

/// Destination of the installed rules file. Fixed by convention; never
/// derived from user input. Must be numbered < 70 (e.g. 69-) so it runs
/// before systemd's 73-seat-late.rules uaccess processor.
pub const DEST_PATH: &str = "/etc/udev/rules.d/69-glacier-eq.rules";
/// Legacy destination from earlier releases that was numbered too late (99-).
#[cfg(target_os = "linux")]
pub const LEGACY_DEST_PATH: &str = "/etc/udev/rules.d/99-glacier-eq.rules";
/// Rules content shipped in `udev/69-glacier-eq.rules`, embedded at compile
/// time so the installer cannot be pointed at a different file.
#[cfg(target_os = "linux")]
const EXPECTED_RULES: &str = include_str!("../../udev/69-glacier-eq.rules");

#[derive(Debug, Clone, Serialize)]
pub struct UdevStatus {
    pub supported: bool,
    pub installed: bool,
    pub up_to_date: bool,
    pub dest_path: String,
    pub has_pkexec: bool,
}

#[cfg(not(target_os = "linux"))]
fn unsupported_status() -> UdevStatus {
    UdevStatus {
        supported: false,
        installed: false,
        up_to_date: false,
        dest_path: DEST_PATH.to_string(),
        has_pkexec: false,
    }
}

/// Compare installed file content against the bundled rules. Normalizes
/// line endings and a single trailing newline so an install verified on a
/// different checkout still matches; any other difference counts as stale.
#[cfg(target_os = "linux")]
fn rules_match(installed: &str, expected: &str) -> bool {
    fn normalize(content: &str) -> String {
        content.replace("\r\n", "\n").trim_end_matches('\n').to_string()
    }
    normalize(installed) == normalize(expected)
}

/// Single-quote a path for `sh -c`. All interpolated paths are constants we
/// generate; refuse anything unexpected rather than escaping it.
#[cfg(target_os = "linux")]
fn shell_quote(path: &str) -> Result<String, String> {
    if path.is_empty() || path.contains('\'') || path.contains('\n') {
        return Err("Refused: unexpected path while building privileged command".into());
    }
    Ok(format!("'{path}'"))
}

#[cfg(target_os = "linux")]
fn has_pkexec() -> bool {
    std::process::Command::new("pkexec")
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(target_os = "linux")]
fn get_udev_status_linux() -> Result<UdevStatus, String> {
    let installed_content = match std::fs::read_to_string(DEST_PATH) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Failed to read {DEST_PATH}: {error}")),
    };
    let legacy_exists = std::fs::symlink_metadata(LEGACY_DEST_PATH).is_ok();
    let installed = installed_content.is_some() || legacy_exists;
    let up_to_date = !legacy_exists
        && installed_content.is_some_and(|content| rules_match(&content, EXPECTED_RULES));
    Ok(UdevStatus {
        supported: true,
        installed,
        up_to_date,
        dest_path: DEST_PATH.to_string(),
        has_pkexec: has_pkexec(),
    })
}

#[cfg(target_os = "linux")]
fn pkexec_missing_error() -> String {
    "pkexec not found. Install polkit (policykit-1), or copy udev/69-glacier-eq.rules \
     to /etc/udev/rules.d/69-glacier-eq.rules manually as root, then run \
     `udevadm control --reload-rules && udevadm trigger --subsystem-match=hidraw --action=change`."
        .to_string()
}

/// Run a fixed privileged script through one polkit prompt. The script is
/// built only from constants, never from user input.
#[cfg(target_os = "linux")]
fn run_pkexec_script(script: &str) -> Result<(), String> {
    let output = std::process::Command::new("pkexec")
        .args(["sh", "-c", script])
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                pkexec_missing_error()
            } else {
                format!("Failed to launch privileged helper: {error}")
            }
        })?;
    if output.status.success() {
        return Ok(());
    }
    // 126/127 from pkexec mean the prompt was dismissed or auth failed;
    // report that distinctly from a script failure so the UI can say
    // "cancelled, nothing changed" instead of "failed".
    if matches!(output.status.code(), Some(126) | Some(127)) {
        return Err("Authorization cancelled or failed — no changes were made.".into());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        Err(format!(
            "Privileged command failed with status {} — no changes may have been applied.",
            output.status
        ))
    } else {
        const MAX_DETAIL: usize = 500;
        let mut detail: String = detail.chars().take(MAX_DETAIL).collect();
        if detail.len() >= MAX_DETAIL {
            detail.push('…');
        }
        Err(format!("Privileged command failed: {detail}"))
    }
}

#[cfg(target_os = "linux")]
fn install_sync() -> Result<(), String> {
    if !has_pkexec() {
        return Err(pkexec_missing_error());
    }
    let tmp: PathBuf =
        std::env::temp_dir().join(format!("glacier-eq-udev-{}.rules", std::process::id()));
    std::fs::write(&tmp, EXPECTED_RULES)
        .map_err(|error| format!("Failed to stage rules file: {error}"))?;
    let tmp_str = tmp.to_string_lossy().into_owned();
    let quoted_tmp = shell_quote(&tmp_str)?;
    let quoted_dest = shell_quote(DEST_PATH)?;
    let quoted_legacy = shell_quote(LEGACY_DEST_PATH)?;
    // One prompt: copy into place, make it world-readable, remove legacy rule,
    // reload udev and re-apply hidraw permissions. `cp`/`chmod`/`rm` paths are quoted constants.
    let script = format!(
        "cp -- {quoted_tmp} {quoted_dest} \
         && chmod 644 {quoted_dest} \
         && rm -f -- {quoted_legacy} \
         && udevadm control --reload-rules \
         && udevadm trigger --subsystem-match=hidraw --action=change"
    );
    let result = run_pkexec_script(&script);
    let _ = std::fs::remove_file(&tmp);
    result?;
    match std::fs::read_to_string(DEST_PATH) {
        Ok(content) if rules_match(&content, EXPECTED_RULES) => Ok(()),
        Ok(_) => Err("Install ran but the installed file differs from the bundled rules.".into()),
        Err(error) => Err(format!("Install ran but verification failed: {error}")),
    }
}

#[cfg(target_os = "linux")]
fn uninstall_sync() -> Result<(), String> {
    if !has_pkexec() {
        return Err(pkexec_missing_error());
    }
    let quoted_dest = shell_quote(DEST_PATH)?;
    let quoted_legacy = shell_quote(LEGACY_DEST_PATH)?;
    let script = format!(
        "rm -f -- {quoted_dest} {quoted_legacy} \
         && udevadm control --reload-rules \
         && udevadm trigger --subsystem-match=hidraw --action=change"
    );
    run_pkexec_script(&script)?;
    if std::fs::symlink_metadata(DEST_PATH).is_ok()
        || std::fs::symlink_metadata(LEGACY_DEST_PATH).is_ok()
    {
        return Err(format!("Remove ran but rules file still exists."));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_udev_status() -> Result<UdevStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "linux")]
        {
            get_udev_status_linux()
        }
        #[cfg(not(target_os = "linux"))]
        {
            Ok(unsupported_status())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn install_udev_rules() -> Result<(), String> {
    // The pkexec prompt can sit open for minutes; keep it off the IPC thread
    // so the UI stays responsive while the user decides.
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "linux")]
        {
            install_sync()
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err("USB permissions installer is only available on Linux desktop.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn uninstall_udev_rules() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "linux")]
        {
            uninstall_sync()
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err("USB permissions installer is only available on Linux desktop.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_match_ignores_trailing_newline_and_crlf() {
        assert!(rules_match("TAG+=\"uaccess\"\n", "TAG+=\"uaccess\""));
        assert!(rules_match("a\r\nb\r\n", "a\nb\n"));
        assert!(!rules_match("TAG+=\"uaccess\"\n", "TAG+=\"group\""));
    }

    #[test]
    fn shell_quote_refuses_hostile_paths() {
        assert_eq!(shell_quote("/etc/udev/rules.d/69-glacier-eq.rules").unwrap(), "'/etc/udev/rules.d/69-glacier-eq.rules'");
        assert!(shell_quote("a'b").is_err());
        assert!(shell_quote("a\nb").is_err());
        assert!(shell_quote("").is_err());
    }

    #[test]
    fn bundled_rules_are_nonempty_and_tag_uaccess() {
        assert!(EXPECTED_RULES.contains("uaccess"));
        assert!(EXPECTED_RULES.contains("MODE=\"0666\""));
        assert!(EXPECTED_RULES.contains("idVendor"));
    }
}
