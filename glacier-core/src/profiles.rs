// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::autoeq::{parse_autoeq_text, peq_to_autoeq, MAX_FILTERS};
use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::SUPPORTED_DEVICES;
use crate::eq::{FilterType, PEQData};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;
#[cfg(unix)]
use std::{
    ffi::CString,
    os::fd::{AsRawFd, FromRawFd},
    os::unix::ffi::OsStrExt,
};

#[cfg(not(target_arch = "wasm32"))]
use fs2::FileExt;

const MAX_PROFILE_BYTES: u64 = 1024 * 1024;
const APP_ID: &str = "com.bukutsu.glaciereq";
const DEFAULT_PROFILE_NAME: &str = "Default EQ";

#[derive(Debug, Clone, serde::Serialize)]
pub struct StoredProfile {
    pub name: String,
    pub data: PEQData,
    pub modified: Option<u64>,
}

fn data_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("GLACIER_EQ_HOME").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    #[cfg(target_os = "windows")]
    let path = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join(APP_ID));
    #[cfg(target_os = "macos")]
    let path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join("Library/Application Support").join(APP_ID));
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let path = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .map(|path| path.join(APP_ID))
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(".local/share").join(APP_ID))
        });
    path.ok_or_else(|| "Cannot resolve Glacier EQ data directory; set GLACIER_EQ_HOME".into())
}

pub struct ProfileStore {
    dir: PathBuf,
}

#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
struct ProfileLock {
    file: std::fs::File,
}

impl Drop for ProfileLock {
    #[cfg(not(target_arch = "wasm32"))]
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }

    #[cfg(target_arch = "wasm32")]
    fn drop(&mut self) {}
}

/// Validate and canonicalize a PEQ for the portable profile text format.
pub fn normalize_for_storage(peq: &PEQData) -> Result<PEQData, String> {
    if peq.filters.len() > MAX_FILTERS {
        return Err(format!(
            "Profile exceeds maximum filter count ({MAX_FILTERS})"
        ));
    }
    crate::device::validate_peq(peq)?;
    let mut normalized = peq.clone();
    normalized.clamp_to_capabilities(&storage_capabilities(peq.filters.len()));
    Ok(normalized)
}

impl ProfileStore {
    pub fn new(base: impl AsRef<Path>) -> Result<Self, String> {
        let dir = base.as_ref().join("profiles");
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create {}: {error}", dir.display()))?;
        let store = Self { dir };
        store.ensure_profiles_directory()?;
        Ok(store)
    }

    fn ensure_profiles_directory(&self) -> Result<(), String> {
        let metadata = std::fs::symlink_metadata(&self.dir)
            .map_err(|error| format!("Failed to inspect profiles directory: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Profiles path must be a real directory, not a symlink".into());
        }
        Ok(())
    }

    fn lock_profiles(&self) -> Result<ProfileLock, String> {
        self.ensure_profiles_directory()?;
        let path = self.dir.join(".profile-operation.lock");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| format!("Failed to open profiles lock: {error}"))?;
        #[cfg(target_arch = "wasm32")]
        return Ok(ProfileLock { file });

        #[cfg(not(target_arch = "wasm32"))]
        {
            for _ in 0..500 {
                match file.try_lock_exclusive() {
                    Ok(()) => return Ok(ProfileLock { file }),
                    // Windows reports ERROR_LOCK_VIOLATION, not WouldBlock.
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            || error.raw_os_error()
                                == fs2::lock_contended_error().raw_os_error() =>
                    {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => {
                        return Err(format!("Failed to lock profiles directory: {error}"))
                    }
                }
            }
            Err("Timed out waiting for another profile operation".into())
        }
    }

    pub fn default_location() -> Result<Self, String> {
        Self::new(data_dir()?)
    }

    pub fn directory(&self) -> &Path {
        &self.dir
    }

    pub fn exists(&self, name: &str) -> Result<bool, String> {
        self.ensure_profiles_directory()?;
        Ok(self.path(name)?.is_file())
    }

    /// Reads every loadable profile together with warnings for each file
    /// that was skipped or had values dropped. Callers must surface the
    /// warnings — without them a broken file simply vanishes from the UI
    /// with no console, log, or diagnostic anywhere.
    pub fn list_detailed(&self) -> Result<(Vec<StoredProfile>, Vec<String>), String> {
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        let mut profiles = Vec::new();
        let mut warnings: Vec<String> = Vec::new();
        for entry in std::fs::read_dir(&self.dir)
            .map_err(|error| format!("Failed to read {}: {error}", self.dir.display()))?
        {
            let path = entry
                .map_err(|error| format!("Failed to read profile entry: {error}"))?
                .path();
            if !has_profile_extension(&path) {
                continue;
            }
            // file_stem round-trip: only expose names that survive a save→load
            // cycle, so everything listed here is always loadable via `load()`.
            let Some(name) = path.file_stem().and_then(|name| name.to_str()) else {
                warnings.extend(skip(&path, "filename is not valid UTF-8"));
                continue;
            };
            if let Err(error) = validate_name(name) {
                warnings.extend(skip(&path, &format!("invalid profile name: {error}")));
                continue;
            }
            let (profile, mut file_warnings) = read_profile(&self.dir, &path)?;
            warnings.append(&mut file_warnings);
            if let Some(profile) = profile {
                profiles.push(profile);
            }
        }
        // One identity (`Foo` and `foo` are the same profile), one entry, and
        // the retained entry is the same file `load()` resolves for that name.
        profiles.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.name.cmp(&right.name))
        });
        profiles.dedup_by(|left, right| left.name.eq_ignore_ascii_case(&right.name));
        Ok((profiles, warnings))
    }

    pub fn list(&self) -> Result<Vec<StoredProfile>, String> {
        Ok(self.list_detailed()?.0)
    }

    pub fn load(&self, name: &str) -> Result<StoredProfile, String> {
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        validate_name(name)?;
        // A malformed case-variant sibling must not shadow a valid profile:
        // walk the same variants list_detailed uses until one is readable.
        for path in self.case_variant_paths(name) {
            let (profile, _) = read_profile(&self.dir, &path)?;
            if let Some(profile) = profile {
                return Ok(profile);
            }
        }
        Err(format!("Profile not found: {name}"))
    }

    /// Saves a profile and returns warnings raised *after* the write landed.
    /// A non-empty list never means the save failed: the bytes are already
    /// fsynced and renamed into place, so the caller must not treat it as one.
    /// Currently the only post-write warning is a case-variant sibling that
    /// could not be removed.
    pub fn save_detailed(&self, name: &str, peq: &PEQData) -> Result<Vec<String>, String> {
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        self.save_locked(name, peq)
    }

    pub fn save(&self, name: &str, peq: &PEQData) -> Result<(), String> {
        self.save_detailed(name, peq).map(|_| ())
    }

    /// Save only when the identity is still absent while holding the
    /// interprocess lock. This closes the CLI's check-then-write race.
    pub fn save_if_absent(&self, name: &str, peq: &PEQData) -> Result<bool, String> {
        validate_name(name)?;
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        if !self.case_variant_paths(name).is_empty()
            || path_entry_exists(&self.dir.join(format!("{name}.txt")))?
        {
            return Ok(false);
        }
        // A surviving case-variant sibling is a warning the CLI prints, not a
        // reason to refuse the write.
        self.save_locked(name, peq).map(|_| ())?;
        Ok(true)
    }

    fn save_locked(&self, name: &str, peq: &PEQData) -> Result<Vec<String>, String> {
        let normalized = normalize_for_storage(peq)?;
        let content = peq_to_autoeq(&normalized);
        if content.len() as u64 > MAX_PROFILE_BYTES {
            return Err("Profile exceeds maximum size (1 MiB)".into());
        }
        let variants = self.case_variant_paths(name);
        let path = self.path(name)?;
        if variants.is_empty() && path_entry_exists(&path)? {
            return Err(format!(
                "A different profile already occupies this filesystem name: {name}"
            ));
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self.dir.join(format!(".glacier-eq-profile-{nonce}.tmp"));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| {
                format!(
                    "Failed to create temporary profile {}: {error}",
                    temporary.display()
                )
            })?;
        if let Err(error) = file
            .write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
        {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "Failed to write temporary profile {}: {error}",
                temporary.display()
            ));
        }
        replace_file(&temporary, &path).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            format!("Failed to save profile {}: {error}", path.display())
        })?;
        // Collapse case-variant siblings so one identity never leaves a stale
        // shadow file behind for `list()` to show or `load()` to read. This is
        // hygiene, not correctness: `list()` already folds an identity to a
        // single entry and `path()`/`load()` already resolve the same winner,
        // so a sibling that survives is at worst a second file for an identity
        // the user still sees once. It must not fail the save — the profile is
        // already fsynced and renamed into place, and an Err from save means
        // "nothing was written": the caller would keep the editor dirty,
        // report a failure for a save that happened, and skip the list
        // refresh, and every retry would fail identically.
        let mut warnings = Vec::new();
        for sibling in self.case_variant_paths(name) {
            if sibling == path {
                continue;
            }
            if let Err(error) = std::fs::remove_file(&sibling) {
                warnings.push(format!(
                    "Profile saved, but duplicate {} could not be removed: {error}",
                    sibling.display()
                ));
            }
        }
        for warning in &warnings {
            eprintln!("glacier-eq: {warning}");
        }
        Ok(warnings)
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        validate_name(name)?;
        let mut failure = None;
        // Remove every case-variant match: deleting one identity must not
        // leave a same-identity file behind for `list()` to resurrect. Unlike
        // the save sweep this *is* a correctness requirement — a surviving
        // file reappears in the list — so a partial delete is still an error.
        for path in self.case_variant_paths(name) {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    failure.get_or_insert(format!("Failed to delete {}: {error}", path.display()));
                }
            };
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Renames a saved profile without rewriting its contents. Refuses to
    /// replace a different profile; a case-only rename changes the spelling.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.ensure_profiles_directory()?;
        let _lock = self.lock_profiles()?;
        validate_name(from)?;
        validate_name(to)?;
        let source = self
            .case_variant_paths(from)
            .into_iter()
            .find(|path| matches!(read_profile(&self.dir, path), Ok((Some(_), _))))
            .ok_or_else(|| format!("Profile not found: {from}"))?;
        let destination = self.dir.join(format!("{to}.txt"));
        if !from.eq_ignore_ascii_case(to)
            && (!self.case_variant_paths(to).is_empty() || path_entry_exists(&destination)?)
        {
            return Err(format!("A profile named \"{to}\" already exists"));
        }
        // Same-identity siblings would resurrect the old name, so drop them
        // before the source moves; a case-only rename keeps them out of the way.
        for sibling in self.case_variant_paths(from) {
            if sibling != source {
                std::fs::remove_file(&sibling).map_err(|error| {
                    format!("Failed to remove duplicate {}: {error}", sibling.display())
                })?;
            }
        }
        replace_file(&source, &destination)
            .map_err(|error| format!("Failed to rename profile {}: {error}", source.display()))
    }

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        validate_name(name)?;
        let variants = self.case_variant_paths(name);
        if let Some(path) = variants
            .iter()
            .find(|path| matches!(read_profile(&self.dir, path), Ok((Some(_), _))))
        {
            return Ok(path.clone());
        }
        if let Some(existing) = variants.into_iter().next() {
            return Ok(existing);
        }
        Ok(self.dir.join(format!("{name}.txt")))
    }

    /// Every regular `*.txt` file whose stem matches `name` case-insensitively,
    /// sorted so the first entry is the deterministic winner `path()`, `save()`,
    /// and `list()` all agree on (readdir order is not stable across calls).
    /// Directories and symlinks are excluded: a stray `daily.txt` directory
    /// beside `Daily.txt` would otherwise become the resolved path for that
    /// identity, and every save and delete for the profile would then fail
    /// against the directory instead of the real file.
    fn case_variant_paths(&self, name: &str) -> Vec<PathBuf> {
        let Some(entries) = std::fs::read_dir(&self.dir).ok() else {
            return Vec::new();
        };
        let mut paths = entries
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .map(|entry| entry.path())
            .filter(|path| {
                has_profile_extension(path)
                    && path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| stem.eq_ignore_ascii_case(name))
            })
            .collect::<Vec<PathBuf>>();
        paths.sort_by(|left, right| left.file_stem().cmp(&right.file_stem()));
        paths
    }
}

fn path_entry_exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to inspect profile path {}: {error}",
            path.display()
        )),
    }
}

/// True when a directory entry carries the profile extension, matched
/// case-insensitively. A profile's identity is its file stem and is already
/// compared with `eq_ignore_ascii_case`, so `Studio.TXT` and `studio.txt` are
/// the same profile — and on a case-insensitive filesystem (Windows NTFS, the
/// default macOS APFS) or after a case-preserving restore from exFAT/FAT, that
/// is exactly how the extension lands on disk. Matching it exactly orphaned
/// the profile: it vanished from `list()`, `load()` missed it, and `delete()`
/// reported success while the file stayed put.
fn has_profile_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
}

fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    // std::fs::rename replaces an existing destination on Windows
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING), so no pre-delete is
    // needed: deleting first would leave the destination missing if we crash
    // before the rename.
    std::fs::rename(temporary, destination)?;
    // Persist the rename: without a directory fsync, power loss can silently
    // revert the destination to its previous contents.
    #[cfg(unix)]
    if let Some(parent) = destination.parent() {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.trim() != name
        || name.ends_with('.')
        || name.len() > 128
        || !name
            .chars()
            .all(|character| character.is_alphanumeric() || " _-@+&.()".contains(character))
    {
        Err(
            "Profile name contains invalid characters. Use letters, numbers, spaces, and _-@+&.()"
                .into(),
        )
    } else if name
        .split('.')
        .next()
        .is_some_and(|stem| stem.eq_ignore_ascii_case(DEFAULT_PROFILE_NAME))
    {
        // Compare the stem, not the whole name: a profile is stored as
        // `<stem>.txt` and read back by its stem, so "Default EQ.txt" *is*
        // the reserved identity wearing an extension. is_reserved_windows_name
        // below already works this way, and the web mirror's
        // isValidProfileName strips at the first dot too — the two backends
        // disagreed about which stored values survive a load.
        Err("Profile name is reserved for the built-in default profile".into())
    } else if is_reserved_windows_name(name) {
        Err("Profile name is a reserved system name and cannot be used".into())
    } else {
        Ok(())
    }
}

/// Reserved Windows device filenames (case-insensitive, ignoring extension),
/// which are illegal on Windows filesystems and break portable save/load.
fn is_reserved_windows_name(name: &str) -> bool {
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or(name);
    let normalized = stem
        .replace('¹', "1")
        .replace('²', "2")
        .replace('³', "3")
        .to_uppercase();
    RESERVED.contains(&normalized.as_str())
}

pub fn storage_capabilities(num_bands: usize) -> DeviceCapabilities {
    let mut caps = DESKTOP_DAC_CAPS.clone();
    caps.num_bands = num_bands;
    caps.supported_filter_types = FilterType::ALL;
    caps.supports_per_band_enable = true;
    caps.integer_preamp = false;
    for device in SUPPORTED_DEVICES {
        caps.global_gain_range.0 = caps
            .global_gain_range
            .0
            .min(device.caps.global_gain_range.0);
        caps.global_gain_range.1 = caps
            .global_gain_range
            .1
            .max(device.caps.global_gain_range.1);
        caps.band_gain_range.0 = caps.band_gain_range.0.min(device.caps.band_gain_range.0);
        caps.band_gain_range.1 = caps.band_gain_range.1.max(device.caps.band_gain_range.1);
        caps.freq_range.0 = caps.freq_range.0.min(device.caps.freq_range.0);
        caps.freq_range.1 = caps.freq_range.1.max(device.caps.freq_range.1);
        caps.q_range.0 = caps.q_range.0.min(device.caps.q_range.0);
        caps.q_range.1 = caps.q_range.1.max(device.caps.q_range.1);
    }
    caps
}

/// One skipped-or-degraded file, surfaced on stderr so library and CLI
/// consumers see it without extra plumbing.
fn skip(path: &Path, reason: &str) -> Vec<String> {
    let message = format!(
        "Skipped profile {}: {reason}",
        path.file_name().unwrap_or_default().to_string_lossy()
    );
    eprintln!("glacier-eq: {message}");
    vec![message]
}

#[cfg(unix)]
fn open_profile_file(dir: &Path, path: &Path) -> std::io::Result<std::fs::File> {
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "profile path has no file name",
        )
    })?;
    let directory = std::fs::File::open(dir)?;
    let name = CString::new(file_name.as_bytes()).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "profile name contains NUL",
        )
    })?;
    // O_NOFOLLOW closes the symlink_metadata()->File::open TOCTOU window;
    // the descriptor is then checked as a regular file by the caller.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { std::fs::File::from_raw_fd(fd) })
}

#[cfg(windows)]
fn open_profile_file(dir: &Path, path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(dir.join(path.file_name().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "profile path has no file name",
            )
        })?))?;
    if file.metadata()?.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "profile file is a symbolic link",
        ));
    }
    Ok(file)
}

#[cfg(not(any(unix, windows)))]
fn open_profile_file(dir: &Path, path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::open(dir.join(path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "profile path has no file name",
        )
    })?))
}

/// Reads one profile file. Every failure branch used to return a silent
/// `Ok(None)`: the file disappeared from `list()` and the user believed the
/// profile was deleted — permissions, non-UTF-8, oversize, and parse
/// failures all left nothing in console, log, or diagnostics. Warnings now
/// travel back to the caller (recorded as diagnostics by the app layer);
/// `eprintln` covers `load()` and the CLI.
fn read_profile(dir: &Path, path: &Path) -> Result<(Option<StoredProfile>, Vec<String>), String> {
    if !has_profile_extension(path) {
        return Ok((None, Vec::new()));
    }
    let path_metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((None, Vec::new()));
        }
        Err(error) => return Err(format!("Failed to stat {}: {error}", path.display())),
    };
    if !path_metadata.file_type().is_file() {
        // Symlinks and directories are rejected by design (the loader never
        // follows links), but silence is not: a directory named `daily.txt`
        // beside `Daily.txt` shadows that profile identity for save, delete,
        // and load, and the user is the one who has to notice. Name it, so the
        // caller can surface it as a diagnostic instead of leaving the
        // identity silently poisoned.
        return Ok((None, skip(path, "is not a regular file")));
    }
    let file = match open_profile_file(dir, path) {
        Ok(file) => file,
        Err(error) => return Ok((None, skip(path, &format!("cannot be opened: {error}")))),
    };
    let metadata = match file.metadata() {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        Err(error) => return Ok((None, skip(path, &format!("cannot be read: {error}")))),
        Ok(_) => return Ok((None, skip(path, "is not a regular file"))),
    };
    if metadata.len() > MAX_PROFILE_BYTES {
        return Ok((
            None,
            skip(path, &format!("exceeds the {MAX_PROFILE_BYTES} byte limit")),
        ));
    }
    let mut text = String::new();
    if file
        .take(MAX_PROFILE_BYTES + 1)
        .read_to_string(&mut text)
        .is_err()
    {
        return Ok((None, skip(path, "is not readable as UTF-8 text")));
    }
    if text.len() as u64 > MAX_PROFILE_BYTES {
        return Ok((
            None,
            skip(path, &format!("exceeds the {MAX_PROFILE_BYTES} byte limit")),
        ));
    }
    let (mut data, _headphone_name, parse_warnings) = match parse_autoeq_text(&text) {
        Ok(parsed) => parsed,
        Err(error) => return Ok((None, skip(path, &format!("failed to parse: {error}")))),
    };
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut warnings: Vec<String> = parse_warnings
        .into_iter()
        .map(|warning| format!("Profile {file_name}: {warning}"))
        .collect();
    // Enforce a hard filter-count ceiling so a malformed profile can't overflow
    // device band limits on apply.
    if data.filters.len() > MAX_FILTERS {
        warnings.push(format!(
            "Profile {file_name}: truncated {} filters to the {MAX_FILTERS} filter limit",
            data.filters.len()
        ));
        data.filters.truncate(MAX_FILTERS);
    }
    // Sanitize against the storage envelope, not one target device. The apply
    // and match paths perform target-specific clamping later.
    let caps = storage_capabilities(data.filters.len());
    for warning in data.clamp_to_capabilities(&caps) {
        warnings.push(format!("Profile {file_name}: {warning}"));
    }
    for warning in &warnings {
        eprintln!("glacier-eq: {warning}");
    }
    Ok((
        Some(StoredProfile {
            name: path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Unnamed Profile")
                .to_string(),
            data,
            modified: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs()),
        }),
        warnings,
    ))
}
