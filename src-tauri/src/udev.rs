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
#[cfg(target_os = "linux")]
use std::{
    io::{Read, Write},
    os::fd::AsRawFd,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    os::unix::process::CommandExt,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
const AUTH_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(target_os = "linux")]
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Dropping an awaiting command requests cancellation of its blocking worker.
/// Aborting spawn_blocking itself would not stop a running subprocess.
#[cfg(target_os = "linux")]
#[derive(Default)]
struct CommandOwner(Arc<AtomicBool>);

#[cfg(target_os = "linux")]
impl Drop for CommandOwner {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

#[cfg(target_os = "linux")]
struct OwnedChild(Option<Child>);

#[cfg(target_os = "linux")]
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if let Some(child) = self.0.take() {
            crate::hid_helper::kill_and_reap(child);
        }
    }
}

/// Own the process through every error/unwind path. Poll stderr without waiting
/// for EOF (descendants can inherit the pipe), retaining only a bounded prefix.
/// Like the HID transport, cleanup cannot guarantee killing an elevated child:
/// on EPERM an eventual background waiter retains reaping responsibility.
#[cfg(target_os = "linux")]
fn run_bounded(
    command: &mut Command,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<(ExitStatus, Vec<u8>), String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("Privileged command cancelled before launch.".into());
    }
    command.process_group(0);
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                pkexec_missing_error()
            } else {
                format!("Failed to launch privileged helper: {error}")
            }
        })?;
    let mut owned = OwnedChild(Some(child));
    let child = owned.0.as_mut().expect("owned child");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let fd = stderr.as_raw_fd();
    // SAFETY: fd is a live, exclusively owned pipe. Preserve its existing flags.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(format!(
            "Failed to configure helper stderr: {}",
            std::io::Error::last_os_error()
        ));
    }
    let deadline = Instant::now() + timeout;
    let mut detail = Vec::new();
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("Privileged command cancelled; changes may already have been applied. Check USB permissions status.".into());
        }
        if Instant::now() >= deadline {
            return Err("Privileged command timed out; changes may already have been applied. Check USB permissions status.".into());
        }
        let status = child
            .try_wait()
            .map_err(|error| format!("Failed to wait for privileged helper: {error}"))?;
        // Bound each drain as well as retained output: a noisy process must not
        // starve the deadline/cancellation checks or fill an unbounded buffer.
        let mut buffer = [0; 4096];
        for _ in 0..16 {
            match stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let keep = count.min(2_000 - detail.len());
                    detail.extend_from_slice(&buffer[..keep]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(format!("Failed to read helper stderr: {error}")),
            }
        }
        if let Some(status) = status {
            // try_wait reaped the tracked child; terminate any wrapper
            // descendants that inherited its process group before returning.
            crate::hid_helper::kill_process_group(child.id());
            owned.0.take();
            return Ok((status, detail));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Destination of the installed rules file. Fixed by convention; never
/// derived from user input. Must be numbered < 70 (e.g. 69-) so it runs
/// before systemd's 73-seat-late.rules uaccess processor.
pub const DEST_PATH: &str = "/etc/udev/rules.d/69-glacier-eq.rules";
/// Package-owned rule location used by distribution packages.
#[cfg(target_os = "linux")]
pub const PACKAGE_DEST_PATH: &str = "/usr/lib/udev/rules.d/69-glacier-eq.rules";
/// Legacy destination from earlier releases that was numbered too late (99-).
#[cfg(target_os = "linux")]
pub const LEGACY_DEST_PATH: &str = "/etc/udev/rules.d/99-glacier-eq.rules";
/// Rules content shipped in `udev/69-glacier-eq.rules`, embedded at compile
/// time so the installer cannot be pointed at a different file.
#[cfg(target_os = "linux")]
const EXPECTED_RULES: &str = include_str!("../../udev/69-glacier-eq.rules");
#[cfg(target_os = "linux")]
const EXPECTED_RULES_SHA256: &str =
    "20deaec429a39ea7acd57ef14002664b83398c8e813e4d5005da9b1ff7f95a77";

#[derive(Debug, Clone, Serialize)]
pub struct UdevStatus {
    pub supported: bool,
    pub installed: bool,
    pub up_to_date: bool,
    pub package_managed: bool,
    pub dest_path: String,
    pub has_pkexec: bool,
}

#[cfg(not(target_os = "linux"))]
fn unsupported_status() -> UdevStatus {
    UdevStatus {
        supported: false,
        installed: false,
        up_to_date: false,
        package_managed: false,
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
        content
            .replace("\r\n", "\n")
            .trim_end_matches('\n')
            .to_string()
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
fn has_pkexec(cancelled: &AtomicBool) -> bool {
    run_bounded(
        Command::new("pkexec").arg("--version"),
        PROBE_TIMEOUT,
        cancelled,
    )
    .is_ok_and(|(status, _)| status.success())
}

#[cfg(target_os = "linux")]
fn get_udev_status_linux(cancelled: &AtomicBool) -> Result<UdevStatus, String> {
    let read_rules = |path: &str| -> Result<Option<String>, String> {
        match std::fs::read_to_string(path) {
            Ok(content) => Ok(Some(content)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Failed to read {path}: {error}")),
        }
    };
    let installed_content = read_rules(DEST_PATH)?;
    let package_content = read_rules(PACKAGE_DEST_PATH)?;
    let legacy_exists = std::fs::symlink_metadata(LEGACY_DEST_PATH).is_ok();
    let active_content = installed_content.as_ref().or(package_content.as_ref());
    let installed = active_content.is_some() || legacy_exists;
    let up_to_date = !legacy_exists
        && active_content.is_some_and(|content| rules_match(content, EXPECTED_RULES));
    let dest_path = if installed_content.is_some() {
        DEST_PATH.to_string()
    } else if package_content.is_some() {
        PACKAGE_DEST_PATH.to_string()
    } else {
        DEST_PATH.to_string()
    };
    Ok(UdevStatus {
        supported: true,
        installed,
        up_to_date,
        package_managed: package_content.is_some(),
        dest_path,
        has_pkexec: has_pkexec(cancelled),
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
fn run_pkexec_script(script: &str, cancelled: &AtomicBool) -> Result<(), String> {
    let (status, stderr) = run_bounded(
        Command::new("pkexec").args(["sh", "-c", script]),
        AUTH_TIMEOUT,
        cancelled,
    )?;
    if status.success() {
        return Ok(());
    }
    // 126/127 from pkexec mean the prompt was dismissed or auth failed;
    // report that distinctly from a script failure so the UI can say
    // "cancelled, nothing changed" instead of "failed".
    if matches!(status.code(), Some(126) | Some(127)) {
        return Err("Authorization cancelled or failed — no changes were made.".into());
    }
    let detail = String::from_utf8_lossy(&stderr).trim().to_string();
    if detail.is_empty() {
        Err(format!(
            "Privileged command failed with status {} — no changes may have been applied.",
            status
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
struct StagedRules {
    dir: PathBuf,
    file: PathBuf,
}

#[cfg(target_os = "linux")]
impl Drop for StagedRules {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.file);
        let _ = std::fs::remove_dir(&self.dir);
    }
}

#[cfg(target_os = "linux")]
fn stage_rules() -> Result<StagedRules, String> {
    for _ in 0..10 {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("glacier-eq-udev-{}-{nonce}", std::process::id()));
        match std::fs::create_dir(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create private rules directory: {error}")),
        }
        let dir_permissions = std::fs::Permissions::from_mode(0o700);
        if let Err(error) = std::fs::set_permissions(&dir, dir_permissions) {
            let _ = std::fs::remove_dir(&dir);
            return Err(format!("Failed to secure private rules directory: {error}"));
        }
        let file = dir.join("rules");
        let write_result = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&file)
            .and_then(|mut output| {
                output
                    .write_all(EXPECTED_RULES.as_bytes())
                    .and_then(|_| output.sync_all())
            });
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&file);
            let _ = std::fs::remove_dir(&dir);
            return Err(format!("Failed to stage rules file: {error}"));
        }
        return Ok(StagedRules { dir, file });
    }
    Err("Failed to allocate a private rules staging directory".into())
}

#[cfg(target_os = "linux")]
fn install_sync(cancelled: &AtomicBool) -> Result<(), String> {
    if !has_pkexec(cancelled) {
        return Err(pkexec_missing_error());
    }
    let staged = stage_rules()?;
    let tmp_str = staged.file.to_string_lossy().into_owned();
    let quoted_tmp = shell_quote(&tmp_str)?;
    let quoted_dest = shell_quote(DEST_PATH)?;
    let quoted_legacy = shell_quote(LEGACY_DEST_PATH)?;
    // One prompt: stage in the destination directory, atomically rename the
    // complete file into place, make it world-readable, remove the legacy rule,
    // reload udev and re-apply hidraw permissions. The temporary path is
    // created by root in a root-only directory, so a failed copy cannot leave a
    // partially written live rule.
    let dest_dir = shell_quote("/etc/udev/rules.d")?;
    let script = format!(
        "umask 077; tmp_dest=$(mktemp {dest_dir}/.glacier-eq.rules.XXXXXX) \
         && trap 'rm -f -- \"$tmp_dest\"' EXIT \
         && cp -- {quoted_tmp} \"$tmp_dest\" \
         && test \"$(sha256sum -- \"$tmp_dest\" | cut -d' ' -f1)\" = '{EXPECTED_RULES_SHA256}' \
         && chmod 644 \"$tmp_dest\" \
         && mv -f -- \"$tmp_dest\" {quoted_dest} \
         && rm -f -- {quoted_legacy} \
         && udevadm control --reload-rules \
         && udevadm trigger --subsystem-match=hidraw --action=change"
    );
    let result = run_pkexec_script(&script, cancelled);
    drop(staged);
    result?;
    match std::fs::read_to_string(DEST_PATH) {
        Ok(content) if rules_match(&content, EXPECTED_RULES) => Ok(()),
        Ok(_) => Err("Install ran but the installed file differs from the bundled rules.".into()),
        Err(error) => Err(format!("Install ran but verification failed: {error}")),
    }
}

#[cfg(target_os = "linux")]
fn uninstall_sync(cancelled: &AtomicBool) -> Result<(), String> {
    if std::fs::symlink_metadata(PACKAGE_DEST_PATH).is_ok()
        && std::fs::symlink_metadata(DEST_PATH).is_err()
        && std::fs::symlink_metadata(LEGACY_DEST_PATH).is_err()
    {
        return Err("USB permissions are managed by the installed system package; remove the package instead.".into());
    }
    if !has_pkexec(cancelled) {
        return Err(pkexec_missing_error());
    }
    let quoted_dest = shell_quote(DEST_PATH)?;
    let quoted_legacy = shell_quote(LEGACY_DEST_PATH)?;
    let script = format!(
        "rm -f -- {quoted_dest} {quoted_legacy} \
         && udevadm control --reload-rules \
         && udevadm trigger --subsystem-match=hidraw --action=change"
    );
    run_pkexec_script(&script, cancelled)?;
    if std::fs::symlink_metadata(DEST_PATH).is_ok()
        || std::fs::symlink_metadata(LEGACY_DEST_PATH).is_ok()
    {
        return Err("Remove ran but rules file still exists.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_udev_status() -> Result<UdevStatus, String> {
    #[cfg(target_os = "linux")]
    let owner = CommandOwner::default();
    #[cfg(target_os = "linux")]
    let cancelled = owner.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            get_udev_status_linux(&cancelled)
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
    #[cfg(target_os = "linux")]
    let owner = CommandOwner::default();
    #[cfg(target_os = "linux")]
    let cancelled = owner.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            install_sync(&cancelled)
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
    #[cfg(target_os = "linux")]
    let owner = CommandOwner::default();
    #[cfg(target_os = "linux")]
    let cancelled = owner.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            uninstall_sync(&cancelled)
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err("USB permissions installer is only available on Linux desktop.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn bounded_command_preserves_status_and_stderr() {
        let (status, stderr) = run_bounded(
            Command::new("sh").args(["-c", "printf 'script failed' >&2; exit 42"]),
            Duration::from_secs(2),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(status.code(), Some(42));
        assert_eq!(stderr, b"script failed");
    }

    #[test]
    fn bounded_command_drains_noisy_stderr_without_retaining_it_all() {
        let (status, stderr) = run_bounded(
            Command::new("sh").args(["-c", "head -c 100000 /dev/zero >&2"]),
            Duration::from_secs(5),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(status.success());
        assert_eq!(stderr.len(), 2_000);
    }

    #[test]
    fn bounded_command_does_not_wait_for_descendant_stderr_eof() {
        let started = Instant::now();
        let (status, _) = run_bounded(
            Command::new("sh").args(["-c", "sleep 1 >&2 & exit 0"]),
            Duration::from_secs(2),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(status.success());
        assert!(started.elapsed() < Duration::from_millis(900));
    }

    #[test]
    fn bounded_command_kills_descendants_after_parent_exit() {
        let marker = std::env::temp_dir().join(format!(
            "glacier-eq-udev-descendant-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        let script = format!("(sleep 0.2; touch {}) & exit 0", marker.display());
        let (status, _) = run_bounded(
            Command::new("sh").args(["-c", &script]),
            Duration::from_secs(2),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(status.success());
        std::thread::sleep(Duration::from_millis(350));
        assert!(!marker.exists());
    }

    #[test]
    fn bounded_command_times_out() {
        let started = Instant::now();
        let error = run_bounded(
            Command::new("sleep").arg("30"),
            Duration::from_millis(30),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert!(error.contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn dropping_owner_cancels_running_command() {
        let owner = CommandOwner::default();
        let cancelled = owner.0.clone();
        let worker = std::thread::spawn(move || {
            run_bounded(
                Command::new("sleep").arg("30"),
                Duration::from_secs(10),
                &cancelled,
            )
        });
        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        drop(owner);
        let error = worker.join().unwrap().unwrap_err();
        assert!(error.contains("cancelled"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn cancelled_command_is_not_launched() {
        let error = run_bounded(
            &mut Command::new("/nonexistent/glacier-eq-test"),
            Duration::from_secs(1),
            &AtomicBool::new(true),
        )
        .unwrap_err();
        assert!(error.contains("cancelled before launch"), "{error}");
    }

    #[test]
    fn owned_child_drop_kills_and_reaps() {
        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id() as libc::pid_t;
        drop(OwnedChild(Some(child)));
        // SAFETY: waitpid with WNOHANG only queries this child; no pointer is used.
        assert_eq!(
            unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) },
            -1
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }

    #[test]
    fn rules_match_ignores_trailing_newline_and_crlf() {
        assert!(rules_match("TAG+=\"uaccess\"\n", "TAG+=\"uaccess\""));
        assert!(rules_match("a\r\nb\r\n", "a\nb\n"));
        assert!(!rules_match("TAG+=\"uaccess\"\n", "TAG+=\"group\""));
    }

    #[test]
    fn shell_quote_refuses_hostile_paths() {
        assert_eq!(
            shell_quote("/etc/udev/rules.d/69-glacier-eq.rules").unwrap(),
            "'/etc/udev/rules.d/69-glacier-eq.rules'"
        );
        assert!(shell_quote("a'b").is_err());
        assert!(shell_quote("a\nb").is_err());
        assert!(shell_quote("").is_err());
    }

    #[test]
    fn staged_rules_use_a_private_regular_file() {
        let staged = stage_rules().unwrap();
        let dir_mode = std::fs::metadata(&staged.dir).unwrap().permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(&staged.file)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
        assert!(std::fs::symlink_metadata(&staged.file)
            .unwrap()
            .file_type()
            .is_file());
        let dir = staged.dir.clone();
        let file = staged.file.clone();
        drop(staged);
        assert!(!dir.exists());
        assert!(!file.exists());
    }

    #[test]
    fn bundled_rules_are_nonempty_and_tag_uaccess() {
        assert!(EXPECTED_RULES.contains("uaccess"));
        assert!(!EXPECTED_RULES.contains("MODE=\"0666\""));
        assert!(!EXPECTED_RULES.lines().any(|line| line.contains("MODE=")));
        assert!(EXPECTED_RULES.contains("idVendor"));
    }
}
