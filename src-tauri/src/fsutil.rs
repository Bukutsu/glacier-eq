// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Crash-safe file replacement: write to a unique sibling temp file, sync,
//! then rename over the destination. Shared by settings persistence and user
//! text-file exports.

use std::ffi::OsString;
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const ATOMIC_TEMP_PREFIX: &str = ".glacier-eq-atomic-";
const PROFILE_TEMP_PREFIX: &str = ".glacier-eq-profile-";

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
    atomic_write_with_nonce(path, contents, nonce)
}

fn atomic_write_with_nonce(path: &Path, contents: &[u8], nonce: u128) -> Result<(), String> {
    let tmp_path = path.with_file_name(format!("{ATOMIC_TEMP_PREFIX}{nonce}.tmp"));
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
    {
        Ok(file) => file,
        Err(error) => {
            // In particular, do not remove an existing temp on EEXIST: it may
            // belong to a concurrent writer that is about to rename it.
            return Err(format!(
                "Failed to write temporary file {}: {error}",
                tmp_path.display()
            ));
        }
    };
    if let Err(error) = file.write_all(contents).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to write temporary file {}: {error}",
            tmp_path.display()
        ));
    }
    drop(file);

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
            .or_else(|| name.strip_prefix(ATOMIC_TEMP_PREFIX))
            .and_then(|name| name.strip_suffix(".tmp"))
        else {
            continue;
        };
        if nonce.len() < 18 || !nonce.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        // The prefixes are reserved for Glacier EQ and the directory is
        // recorded by an app write. Do not require the export marker: a crash
        // can truncate it before rename, and dialog saves use atomic_write's
        // separate prefix.
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
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        // Only Glacier EQ's reserved temp prefixes are eligible. Broad user
        // directories may contain unrelated files with numeric suffixes.
        let nonce = name
            .strip_prefix(ATOMIC_TEMP_PREFIX)
            .or_else(|| name.strip_prefix(PROFILE_TEMP_PREFIX))
            .and_then(|name| name.strip_suffix(".tmp"));
        let Some(nonce) = nonce else {
            continue;
        };
        if nonce.len() < 18 || !nonce.chars().all(|character| character.is_ascii_digit()) {
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
