// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Crash-safe file replacement: write to a unique sibling temp file, sync,
//! then rename over the destination. Shared by settings persistence and user
//! text-file exports.

use std::ffi::OsString;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::{
    fd::AsRawFd,
    unix::ffi::{OsStrExt, OsStringExt},
};

#[cfg(unix)]
use std::{ffi::CString, os::fd::FromRawFd, path::Component};

pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    // Unique temp name per write: two app instances share the directory but
    // not this process's lock, so a fixed name could interleave and publish a
    // partially written file.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = path.with_extension(format!("{nonce}.tmp"));
    let write_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .and_then(|mut file| file.write_all(contents).and_then(|_| file.sync_all()));
    if let Err(error) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to write temporary file {}: {error}",
            tmp_path.display()
        ));
    }

    // std::fs::rename replaces an existing destination on Windows
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING), so no pre-delete is
    // needed: deleting first would leave the destination missing if we crash
    // before the rename.
    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to replace {}: {error}", path.display()));
    }
    // Persist the rename: without a directory fsync, power loss can silently
    // revert the file to the previous version.
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Atomically writes below a trusted base while holding directory file
/// descriptors for every component. A concurrent rename of a parent directory
/// therefore cannot redirect the temporary file or final rename through a
/// symlink between validation and use.
const EXPORT_TEMP_PREFIX: &str = ".glacier-eq-export-";
const EXPORT_TEMP_MARKER: &[u8] = b"glacier-eq-export-temp-v1\n";

#[cfg(unix)]
fn atomic_write_in_base_impl(
    path: &Path,
    base: &Path,
    contents: &[u8],
    export_marker: Option<&[u8]>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Destination has no parent directory".to_string())?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("Failed to resolve destination directory: {error}"))?;
    let relative_parent = parent
        .strip_prefix(base)
        .map_err(|_| "Destination is outside the trusted base".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Destination has no file name".to_string())?;
    let file_name_c = CString::new(file_name.as_bytes())
        .map_err(|_| "Destination name contains a NUL byte".to_string())?;
    let base_c = CString::new(base.as_os_str().as_bytes())
        .map_err(|_| "Base path contains a NUL byte".to_string())?;
    // SAFETY: base is opened read-only as a directory; the returned descriptor
    // is immediately owned by this function and closed on every return path.
    let base_fd = unsafe {
        libc::open(
            base_c.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if base_fd < 0 {
        return Err(format!(
            "Failed to open trusted base directory: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut directory_fd = base_fd;
    let close_directory = |fd: libc::c_int| {
        if fd >= 0 {
            unsafe { libc::close(fd) };
        }
    };

    for component in relative_parent.components() {
        let Component::Normal(name) = component else {
            close_directory(directory_fd);
            return Err("Destination path contains an unsafe component".into());
        };
        let name_c = match CString::new(name.as_bytes()) {
            Ok(name) => name,
            Err(_) => {
                close_directory(directory_fd);
                return Err("Destination path contains a NUL byte".into());
            }
        };
        // SAFETY: directory_fd is owned here and name_c is NUL-terminated.
        let next_fd = unsafe {
            libc::openat(
                directory_fd,
                name_c.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        close_directory(directory_fd);
        if next_fd < 0 {
            return Err(format!(
                "Failed to open destination directory: {}",
                std::io::Error::last_os_error()
            ));
        }
        directory_fd = next_fd;
    }

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_name = if export_marker.is_some() {
        format!("{EXPORT_TEMP_PREFIX}{nonce}.tmp")
    } else {
        format!(".{file_name}.{nonce}.tmp")
    };
    let temporary_c = match CString::new(temporary_name.as_bytes()) {
        Ok(name) => name,
        Err(_) => {
            close_directory(directory_fd);
            return Err("Temporary name contains a NUL byte".into());
        }
    };
    // SAFETY: directory_fd is an owned directory descriptor and the temporary
    // name is NUL-terminated. O_EXCL prevents replacing an existing entry.
    let temporary_fd = unsafe {
        libc::openat(
            directory_fd,
            temporary_c.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if temporary_fd < 0 {
        close_directory(directory_fd);
        return Err(format!(
            "Failed to create secure temporary file: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: temporary_fd is a fresh owned descriptor returned by openat.
    let mut temporary = unsafe { fs::File::from_raw_fd(temporary_fd) };
    let write_result = export_marker
        .map(|marker| {
            temporary
                .write_all(marker)
                .and_then(|_| temporary.sync_all())
                .and_then(|_| temporary.set_len(0))
                .and_then(|_| temporary.seek(SeekFrom::Start(0)))
        })
        .unwrap_or(Ok(0))
        .and_then(|_| {
            temporary
                .write_all(contents)
                .and_then(|_| temporary.sync_all())
        });
    if let Err(error) = write_result {
        let _ = temporary.sync_all();
        // SAFETY: both descriptors are owned by this function.
        unsafe {
            libc::unlinkat(directory_fd, temporary_c.as_ptr(), 0);
            libc::close(directory_fd);
        }
        return Err(format!("Failed to write secure temporary file: {error}"));
    }
    drop(temporary);
    // SAFETY: both names are NUL-terminated and directory_fd remains owned.
    let rename_result = unsafe {
        libc::renameat(
            directory_fd,
            temporary_c.as_ptr(),
            directory_fd,
            file_name_c.as_ptr(),
        )
    };
    if rename_result < 0 {
        let error = std::io::Error::last_os_error();
        // SAFETY: directory_fd is still owned; temporary_c is NUL-terminated.
        unsafe {
            libc::unlinkat(directory_fd, temporary_c.as_ptr(), 0);
            libc::close(directory_fd);
        }
        return Err(format!("Failed to replace secure destination: {error}"));
    }
    // SAFETY: directory_fd is owned and remains open after rename.
    unsafe {
        libc::fsync(directory_fd);
        libc::close(directory_fd);
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn atomic_write_export_in_base(
    path: &Path,
    base: &Path,
    contents: &[u8],
) -> Result<(), String> {
    atomic_write_in_base_impl(path, base, contents, Some(EXPORT_TEMP_MARKER))
}

#[cfg(not(unix))]
pub(crate) fn atomic_write_export_in_base(
    path: &Path,
    _base: &Path,
    contents: &[u8],
) -> Result<(), String> {
    atomic_write(path, contents)
}

/// Temp files younger than this are never swept. The sweep runs at every
/// launch, and a second app instance starts while a sibling may hold a live
/// temp between `atomic_write`/`ProfileStore::save`'s create and rename —
/// deleting it would make that sibling's rename fail with
/// "Failed to replace …" and its save would be lost. One hour is orders of
/// magnitude beyond any realistic write→fsync→rename window, while still
/// clearing crash orphans on any launch an hour after the crash.
const STALE_TEMP_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// How far below the swept directory the sweep descends: `<appdata>/profiles`
/// holds `ProfileStore::save` temps one level down; nothing nests deeper, and
/// a bounded depth keeps the sweep from wandering arbitrary user trees.
const SWEEP_DEPTH: usize = 1;

/// Best-effort removal of temp files orphaned by a crash between creation and
/// rename, descending [`SWEEP_DEPTH`] levels (the `profiles/` child of the
/// app-data dir holds its own temps). Only matches the numeric-nonce naming
/// used by [`atomic_write`] (`{stem}.{nanos}.tmp`) and `ProfileStore::save`
/// (`.{nanos}.tmp`) AND only once the file is older than [`STALE_TEMP_AGE`],
/// so real user files that happen to end in `.tmp` — and a live sibling
/// instance's in-flight writes — are never touched.
pub(crate) fn sweep_stale_temp_files(dir: &Path) {
    sweep_at(dir, SWEEP_DEPTH);
}

/// Where [`record_export_dir`] remembers local directories that received an
/// `atomic_write` temp, relative to the app-data dir.
const EXPORT_MANIFEST_FILE: &str = "export_dirs.txt";

/// Bound on the recorded-directory manifest: keep the most recent entries.
/// Covers a realistic set of export locations while keeping the startup
/// sweep cheap and the file from growing without limit.
const MAX_RECORDED_EXPORT_DIRS: usize = 100;

#[cfg(unix)]
fn with_manifest_lock<T>(
    appdata: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock_path = appdata.join("export_dirs.lock");
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("Failed to open export manifest lock: {error}"))?;
    // SAFETY: lock owns a live file descriptor for the duration of the guard.
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } < 0 {
        return Err(format!(
            "Failed to lock export manifest: {}",
            std::io::Error::last_os_error()
        ));
    }
    let result = operation();
    // SAFETY: the descriptor remains owned by lock until after unlock.
    unsafe {
        libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
    }
    result
}

#[cfg(not(unix))]
fn with_manifest_lock<T>(
    _appdata: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    operation()
}

fn encode_export_path(path: &Path) -> Option<String> {
    #[cfg(unix)]
    let bytes = path.as_os_str().as_bytes();
    #[cfg(not(unix))]
    let bytes = path.to_str()?.as_bytes();
    let mut encoded = String::from("hex:");
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").ok()?;
    }
    Some(encoded)
}

fn decode_export_path(encoded: &str) -> Option<PathBuf> {
    if let Some(hex) = encoded.strip_prefix("hex:") {
        if hex.len() % 2 != 0 {
            return None;
        }
        let mut bytes = Vec::with_capacity(hex.len() / 2);
        let encoded_bytes = hex.as_bytes();
        for index in (0..encoded_bytes.len()).step_by(2) {
            let text = std::str::from_utf8(&encoded_bytes[index..index + 2]).ok()?;
            bytes.push(u8::from_str_radix(text, 16).ok()?);
        }
        #[cfg(unix)]
        return Some(PathBuf::from(OsString::from_vec(bytes)));
        #[cfg(not(unix))]
        return Some(PathBuf::from(String::from_utf8(bytes).ok()?));
    }
    // Legacy unescaped entries are accepted only as absolute paths. They are
    // never trusted for deletion without the new temp marker below.
    let path = PathBuf::from(encoded);
    path.is_absolute().then_some(path)
}

/// Remembers the directory a local text export was written into so
/// [`sweep_recorded_export_dirs`] can reclaim a crash orphan there on a
/// later launch. Dialog-chosen and nested destinations can sit beyond
/// [`SWEEP_DEPTH`] of any allowed base — or entirely outside the bases
/// (an external drive) — where the base sweep never walks; without this
/// record such an orphan was permanent litter. Only directories we
/// ourselves wrote into are ever remembered. Best-effort: a failed record
/// must never fail the export that triggered it.
pub(crate) fn record_export_dir(appdata: &Path, written: &Path) {
    let Some(dir) = written.parent() else {
        return;
    };
    let Ok(dir) = fs::canonicalize(dir) else {
        return;
    };
    if !dir.is_absolute() {
        return;
    }
    let Some(encoded) = encode_export_path(&dir) else {
        return;
    };
    let result = with_manifest_lock(appdata, || {
        let manifest = appdata.join(EXPORT_MANIFEST_FILE);
        let existing = fs::read_to_string(&manifest).unwrap_or_default();
        let mut dirs: Vec<String> = existing.lines().map(str::to_string).collect();
        if dirs.iter().any(|entry| entry == &encoded) {
            return Ok(());
        }
        dirs.push(encoded);
        if dirs.len() > MAX_RECORDED_EXPORT_DIRS {
            let overflow = dirs.len() - MAX_RECORDED_EXPORT_DIRS;
            dirs.drain(..overflow);
        }
        atomic_write(&manifest, dirs.join("\n").as_bytes())
    });
    if let Err(error) = result {
        eprintln!(
            "glacier-eq: cannot record export dir {}: {error}",
            written.display()
        );
    }
}

/// Sweeps every directory [`record_export_dir`] remembered, at
/// direct-children depth: the recorded dir is the exported file's own
/// parent, so nested and outside-base destinations are covered by
/// construction. A recorded dir that no longer exists (unplugged drive)
/// is skipped silently by [`sweep_at`]'s `NotFound` handling, and the
/// nonce-plus-age matcher still spares everything that is not a crash
/// orphan.
pub(crate) fn sweep_recorded_export_dirs(appdata: &Path) {
    let manifest = appdata.join(EXPORT_MANIFEST_FILE);
    let contents = match with_manifest_lock(appdata, || {
        fs::read_to_string(&manifest).map_err(|error| error.to_string())
    }) {
        Ok(contents) => contents,
        Err(_) => return,
    };
    for line in contents.lines() {
        let Some(dir) = decode_export_path(line.trim()) else {
            continue;
        };
        sweep_export_dir(&dir);
    }
}

fn sweep_export_dir(dir: &Path) {
    match fs::symlink_metadata(dir) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) | Err(_) => return,
    }
    let Ok(dir) = fs::canonicalize(dir) else {
        return;
    };
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            eprintln!(
                "glacier-eq: export temp sweep cannot list {}: {error}",
                dir.display()
            );
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().is_ok_and(|file_type| file_type.is_file()) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(nonce) = name
            .strip_prefix(EXPORT_TEMP_PREFIX)
            .and_then(|name| name.strip_suffix(".tmp"))
        else {
            continue;
        };
        if nonce.len() < 18 || !nonce.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        let mut marker = vec![0; EXPORT_TEMP_MARKER.len()];
        let has_marker = fs::File::open(&path)
            .and_then(|mut file| file.read_exact(&mut marker))
            .is_ok()
            && marker == EXPORT_TEMP_MARKER;
        if !has_marker {
            continue;
        }
        match fs::metadata(&path).and_then(|metadata| metadata.modified()) {
            Ok(modified) if modified.elapsed().unwrap_or_default() < STALE_TEMP_AGE => {}
            Ok(_) => {
                if let Err(error) = fs::remove_file(&path) {
                    eprintln!(
                        "glacier-eq: export temp sweep cannot remove {}: {error}",
                        path.display()
                    );
                }
            }
            Err(error) => eprintln!(
                "glacier-eq: export temp sweep cannot age {}: {error}",
                path.display()
            ),
        }
    }
}

fn sweep_at(dir: &Path, depth: usize) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // A not-yet-created child (profiles/ on first run) is expected;
        // anything else we cannot list must not vanish silently.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            eprintln!(
                "glacier-eq: temp sweep cannot list {}: {error}",
                dir.display()
            );
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // DirEntry::file_type does not follow symlinks, so a symlinked
        // directory is never descended into.
        if entry.file_type().is_ok_and(|file_type| file_type.is_dir()) {
            if depth > 0 {
                sweep_at(&path, depth - 1);
            }
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("tmp") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        // The nonce is nanoseconds since the Unix epoch (19 digits for the
        // foreseeable future); require a long numeric tail to stay strict.
        let tail = stem.rsplit('.').next().unwrap_or(stem);
        if tail.len() < 18 || !tail.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        match fs::metadata(&path).and_then(|metadata| metadata.modified()) {
            // Another instance's live temp — leave it for its rename.
            Ok(modified) if modified.elapsed().unwrap_or_default() < STALE_TEMP_AGE => {}
            Ok(_) => {
                if let Err(error) = fs::remove_file(&path) {
                    eprintln!(
                        "glacier-eq: temp sweep cannot remove {}: {error}",
                        path.display()
                    );
                }
            }
            Err(error) => {
                eprintln!(
                    "glacier-eq: temp sweep cannot age {}: {error}",
                    path.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temporary_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glacier-eq-fsutil-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn secure_write_rejects_symlinked_parent_and_replaces_final_symlink() {
        let root = temporary_dir();
        let base = root.join("base");
        let outside = root.join("outside");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_file = outside.join("report.txt");
        fs::write(&outside_file, b"outside").unwrap();

        let parent_link = root.join("linked-base");
        std::os::unix::fs::symlink(&outside, &parent_link).unwrap();
        let linked_path = parent_link.join("report.txt");
        assert!(atomic_write_in_base_impl(&linked_path, &base, b"blocked", None).is_err());
        assert_eq!(fs::read(&outside_file).unwrap(), b"outside");

        let destination = base.join("report.txt");
        std::os::unix::fs::symlink(&outside_file, &destination).unwrap();
        atomic_write_in_base_impl(&destination, &base, b"inside", None).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"inside");
        assert_eq!(fs::read(&outside_file).unwrap(), b"outside");

        let _ = fs::remove_dir_all(root);
    }

    fn set_stale(path: &Path) {
        let file = fs::File::options().write(true).open(path).unwrap();
        let stale =
            std::time::SystemTime::now() - STALE_TEMP_AGE - std::time::Duration::from_secs(60);
        file.set_modified(stale).unwrap();
    }

    #[test]
    fn sweep_removes_only_crash_orphaned_temp_files() {
        let dir = temporary_dir();
        // Orphans from both temp-naming schemes (19-digit nanosecond nonces),
        // old enough to be crashes rather than a sibling's live writes.
        let settings_orphan = dir.join("settings.1700000000000000000.tmp");
        let profile_orphan = dir.join(".1700000000000000000.tmp");
        fs::write(&settings_orphan, b"x").unwrap();
        fs::write(&profile_orphan, b"x").unwrap();
        set_stale(&settings_orphan);
        set_stale(&profile_orphan);
        // Files that merely end in .tmp, or whose tail is not a fresh nonce.
        fs::write(dir.join("notes.tmp"), b"x").unwrap();
        fs::write(dir.join("report.20240101.tmp"), b"x").unwrap();
        // Real data living next to the temps must survive.
        fs::write(dir.join("settings.json"), b"{}").unwrap();
        fs::write(dir.join("Daily.txt"), b"").unwrap();

        sweep_stale_temp_files(&dir);

        assert!(!dir.join("settings.1700000000000000000.tmp").exists());
        assert!(!dir.join(".1700000000000000000.tmp").exists());
        assert!(dir.join("notes.tmp").exists());
        assert!(dir.join("report.20240101.tmp").exists());
        assert!(dir.join("settings.json").exists());
        assert!(dir.join("Daily.txt").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweep_spares_a_fresh_temp_that_a_live_sibling_instance_may_own() {
        let dir = temporary_dir();
        // Created now: another instance could be between create and rename.
        let fresh = dir.join("settings.1700000000000000001.tmp");
        fs::write(&fresh, b"x").unwrap();

        sweep_stale_temp_files(&dir);

        assert!(
            fresh.exists(),
            "a fresh temp may be a sibling instance's in-flight write"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweep_reaches_profile_temps_one_level_down() {
        let dir = temporary_dir();
        let profiles = dir.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        // ProfileStore::save writes `.{nonce}.tmp` INSIDE profiles/, which a
        // flat sweep of the app-data root never saw.
        let orphan = profiles.join(".1700000000000000002.tmp");
        fs::write(&orphan, b"x").unwrap();
        set_stale(&orphan);
        // Fresh sibling temp and a real profile must survive.
        let fresh = profiles.join(".1700000000000000003.tmp");
        fs::write(&fresh, b"x").unwrap();
        fs::write(profiles.join("My DAC.txt"), b"Preamp: 0.0").unwrap();

        sweep_stale_temp_files(&dir);

        assert!(!orphan.exists(), "stale profile temp must be swept");
        assert!(fresh.exists());
        assert!(profiles.join("My DAC.txt").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweep_ignores_missing_directory() {
        sweep_stale_temp_files(Path::new("/definitely/not/a/real/dir/glacier-eq"));
    }

    #[test]
    fn recorded_export_dirs_are_swept_even_outside_the_bases() {
        let appdata = temporary_dir();
        // A dialog-chosen destination no allowed-base sweep walks to.
        let external = temporary_dir();
        let orphan = external.join(format!("{EXPORT_TEMP_PREFIX}1700000000000000004.tmp"));
        fs::write(&orphan, EXPORT_TEMP_MARKER).unwrap();
        set_stale(&orphan);
        let fresh = external.join(format!("{EXPORT_TEMP_PREFIX}1700000000000000005.tmp"));
        fs::write(&fresh, EXPORT_TEMP_MARKER).unwrap();
        let unmarked = external.join(format!("{EXPORT_TEMP_PREFIX}1700000000000000006.tmp"));
        fs::write(&unmarked, b"user file").unwrap();
        set_stale(&unmarked);
        fs::write(external.join("Report.txt"), b"keep").unwrap();

        record_export_dir(&appdata, &external.join("Report.txt"));
        // Recording the same destination again must not duplicate entries.
        record_export_dir(&appdata, &external.join("Report.txt"));
        sweep_recorded_export_dirs(&appdata);

        assert!(
            !orphan.exists(),
            "a stale temp in a recorded dir must be swept"
        );
        assert!(fresh.exists(), "a fresh temp may be a sibling's live write");
        assert!(unmarked.exists(), "an unmarked user file must be preserved");
        assert!(external.join("Report.txt").exists());
        let manifest = fs::read_to_string(appdata.join(EXPORT_MANIFEST_FILE)).unwrap();
        assert_eq!(
            manifest.lines().count(),
            1,
            "recordings dedupe, manifest: {manifest:?}"
        );

        let _ = fs::remove_dir_all(&appdata);
        let _ = fs::remove_dir_all(&external);
    }

    #[test]
    fn export_manifest_updates_are_serialized() {
        let appdata = temporary_dir();
        let first = temporary_dir();
        let second = temporary_dir();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = [first.clone(), second.clone()]
            .into_iter()
            .map(|directory| {
                let appdata = appdata.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    record_export_dir(&appdata, &directory.join("Report.txt"));
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let manifest = fs::read_to_string(appdata.join(EXPORT_MANIFEST_FILE)).unwrap();
        assert_eq!(manifest.lines().count(), 2, "manifest: {manifest:?}");

        let _ = fs::remove_dir_all(appdata);
        let _ = fs::remove_dir_all(first);
        let _ = fs::remove_dir_all(second);
    }

    #[cfg(unix)]
    #[test]
    fn export_manifest_preserves_non_utf8_directory_names() {
        let appdata = temporary_dir();
        let root = temporary_dir();
        let mut name = OsString::from("export-");
        name.push(OsString::from_vec(vec![0xff]));
        let external = root.join(name);
        fs::create_dir(&external).unwrap();
        let orphan = external.join(format!("{EXPORT_TEMP_PREFIX}1700000000000000007.tmp"));
        fs::write(&orphan, EXPORT_TEMP_MARKER).unwrap();
        set_stale(&orphan);

        record_export_dir(&appdata, &external.join("Report.txt"));
        sweep_recorded_export_dirs(&appdata);

        assert!(!orphan.exists());
        let _ = fs::remove_dir_all(appdata);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sweep_of_recorded_dirs_ignores_unrecorded_dirs_and_missing_drives() {
        let appdata = temporary_dir();
        let other = temporary_dir();
        let orphan = other.join("Notes.1700000000000000006.tmp");
        fs::write(&orphan, b"x").unwrap();
        set_stale(&orphan);

        // Only directories we recorded are ever swept: the sweep must not
        // wander arbitrary user trees.
        sweep_recorded_export_dirs(&appdata);
        assert!(orphan.exists(), "unrecorded dirs are out of scope");

        // A recorded dir that vanished (unplugged drive) is a silent no-op.
        fs::write(
            appdata.join(EXPORT_MANIFEST_FILE),
            "/definitely/not/a/real/dir/glacier-eq",
        )
        .unwrap();
        sweep_recorded_export_dirs(&appdata);

        let _ = fs::remove_dir_all(&appdata);
        let _ = fs::remove_dir_all(&other);
    }
}
