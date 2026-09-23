// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::autoeq::{parse_autoeq_text, peq_to_autoeq, MAX_FILTERS};
use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::SUPPORTED_DEVICES;
use crate::eq::{FilterType, PEQData};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_PROFILE_BYTES: u64 = 1024 * 1024;
const APP_ID: &str = "com.bukutsu.glaciereq";

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

impl ProfileStore {
    pub fn new(base: impl AsRef<Path>) -> Result<Self, String> {
        let dir = base.as_ref().join("profiles");
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create {}: {error}", dir.display()))?;
        Ok(Self { dir })
    }

    pub fn default_location() -> Result<Self, String> {
        Self::new(data_dir()?)
    }

    pub fn directory(&self) -> &Path {
        &self.dir
    }

    pub fn exists(&self, name: &str) -> Result<bool, String> {
        Ok(self.path(name)?.is_file())
    }

    pub fn list(&self) -> Result<Vec<StoredProfile>, String> {
        let mut profiles = Vec::new();
        for entry in std::fs::read_dir(&self.dir)
            .map_err(|error| format!("Failed to read {}: {error}", self.dir.display()))?
        {
            let path = entry
                .map_err(|error| format!("Failed to read profile entry: {error}"))?
                .path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("txt") {
                continue;
            }
            // file_stem round-trip: only expose names that survive a save→load
            // cycle, so everything listed here is always loadable via `load()`.
            let Some(name) = path.file_stem().and_then(|name| name.to_str()) else {
                continue;
            };
            if validate_name(name).is_err() {
                continue;
            }
            if let Some(profile) = read_profile(&path)? {
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
        Ok(profiles)
    }

    pub fn load(&self, name: &str) -> Result<StoredProfile, String> {
        read_profile(&self.path(name)?)?.ok_or_else(|| format!("Profile not found: {name}"))
    }

    pub fn save(&self, name: &str, peq: &PEQData) -> Result<(), String> {
        if peq.filters.len() > MAX_FILTERS {
            return Err(format!(
                "Profile exceeds maximum filter count ({MAX_FILTERS})"
            ));
        }
        let content = peq_to_autoeq(peq);
        if content.len() as u64 > MAX_PROFILE_BYTES {
            return Err("Profile exceeds maximum size (1 MiB)".into());
        }
        let path = self.path(name)?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self.dir.join(format!(".{nonce}.tmp"));
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
        // shadow file behind for `list()` to show or `load()` to read.
        for sibling in self.case_variant_paths(name) {
            if sibling == path {
                continue;
            }
            std::fs::remove_file(&sibling).map_err(|error| {
                format!(
                    "Profile saved, but duplicate {} could not be removed: {error}",
                    sibling.display()
                )
            })?;
        }
        Ok(())
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        validate_name(name)?;
        let mut failure = None;
        // Remove every case-variant match: deleting one identity must not
        // leave a same-identity file behind for `list()` to resurrect.
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

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        validate_name(name)?;
        if let Some(existing) = self.case_variant_paths(name).into_iter().next() {
            return Ok(existing);
        }
        Ok(self.dir.join(format!("{name}.txt")))
    }

    /// Every `*.txt` file whose stem matches `name` case-insensitively,
    /// sorted so the first entry is the deterministic winner `path()`, `save()`,
    /// and `list()` all agree on (readdir order is not stable across calls).
    fn case_variant_paths(&self, name: &str) -> Vec<PathBuf> {
        let Some(entries) = std::fs::read_dir(&self.dir).ok() else {
            return Vec::new();
        };
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension().and_then(|ext| ext.to_str()) == Some("txt")
                    && path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| stem.eq_ignore_ascii_case(name))
            })
            .collect();
        paths.sort_by(|left, right| left.file_stem().cmp(&right.file_stem()));
        paths
    }
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
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name);
    RESERVED.contains(&stem.to_uppercase().as_str())
}

fn storage_capabilities(num_bands: usize) -> DeviceCapabilities {
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

fn read_profile(path: &Path) -> Result<Option<StoredProfile>, String> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("txt") {
        return Ok(None);
    }
    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to stat {}: {error}", path.display()))?;
    if !path_metadata.file_type().is_file() {
        return Ok(None);
    }
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let metadata = match file.metadata() {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        _ => return Ok(None),
    };
    if metadata.len() > MAX_PROFILE_BYTES {
        return Ok(None);
    }
    let mut text = String::new();
    if file
        .take(MAX_PROFILE_BYTES + 1)
        .read_to_string(&mut text)
        .is_err()
        || text.len() as u64 > MAX_PROFILE_BYTES
    {
        return Ok(None);
    }
    let (mut data, _, _) = match parse_autoeq_text(&text) {
        Ok(profile) => profile,
        Err(_) => return Ok(None),
    };
    // Enforce a hard filter-count ceiling so a malformed profile can't overflow
    // device band limits on apply.
    if data.filters.len() > MAX_FILTERS {
        data.filters.truncate(MAX_FILTERS);
    }
    // Sanitize against the storage envelope, not one target device. The apply
    // and match paths perform target-specific clamping later.
    let caps = storage_capabilities(data.filters.len());
    let _ = data.clamp_to_capabilities(&caps);
    Ok(Some(StoredProfile {
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
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glacier-eq-profile-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn profile_round_trip_and_escape_rejection() {
        let base = temporary_dir();
        let store = ProfileStore::new(&base).unwrap();
        let peq = PEQData {
            filters: vec![crate::Filter::enabled(0, true)],
            global_gain: -2.0,
        };
        store.save("Daily", &peq).unwrap();
        assert_eq!(store.load("Daily").unwrap().data, peq);
        let replacement = PEQData {
            filters: vec![],
            global_gain: -3.0,
        };
        store.save("daily", &replacement).unwrap();
        assert_eq!(store.load("Daily").unwrap().data, replacement);
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.save("../escape", &peq).is_err());
        store.delete("Daily").unwrap();
        assert!(store.list().unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn profile_filter_limit_round_trips_and_rejects_oversized_replacement() {
        let base = temporary_dir();
        let store = ProfileStore::new(&base).unwrap();
        let peq = PEQData {
            filters: (0..MAX_FILTERS)
                .map(|index| crate::Filter::enabled(index as u8, true))
                .collect(),
            global_gain: -2.0,
        };

        store.save("Full", &peq).unwrap();
        assert_eq!(store.load("Full").unwrap().data.filters.len(), MAX_FILTERS);

        let mut oversized = peq;
        oversized
            .filters
            .push(crate::Filter::enabled(MAX_FILTERS as u8, true));
        assert!(store.save("Full", &oversized).is_err());
        assert_eq!(store.load("Full").unwrap().data.filters.len(), MAX_FILTERS);

        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn case_variant_duplicates_share_one_identity() {
        let base = temporary_dir();
        let store = ProfileStore::new(&base).unwrap();
        let upper = PEQData {
            filters: vec![crate::Filter::enabled(0, true)],
            global_gain: -1.0,
        };
        let lower = PEQData {
            filters: vec![],
            global_gain: -5.0,
        };
        std::fs::write(base.join("profiles/Foo.txt"), peq_to_autoeq(&upper)).unwrap();
        std::fs::write(base.join("profiles/foo.txt"), peq_to_autoeq(&lower)).unwrap();

        // list() shows one entry, and it is exactly what load() resolves for
        // either spelling — no shadow profile that disagrees with load().
        let listed = store.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(store.load("Foo").unwrap().data, listed[0].data);
        assert_eq!(store.load("foo").unwrap().data, listed[0].data);

        // save() collapses the sibling instead of leaving a stale duplicate.
        store.save("FOO", &lower).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.load("Foo").unwrap().data, lower);

        // A freshly recreated sibling is also collapsed, and delete() removes
        // every case-variant match so the identity cannot resurrect.
        std::fs::write(base.join("profiles/FOO.txt"), peq_to_autoeq(&upper)).unwrap();
        store.delete("foo").unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(!base.join("profiles/Foo.txt").exists());
        assert!(!base.join("profiles/FOO.txt").exists());

        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn storage_envelope_matches_web_mirror() {
        // src/lib/backend/web.ts clamps loaded profiles to STORAGE_ENVELOPE;
        // both sides must stay in lockstep or the platforms disagree about
        // which stored values survive a load.
        let caps = storage_capabilities(10);
        assert_eq!(caps.global_gain_range, (-20, 12));
        assert_eq!(caps.band_gain_range, (-12.0, 12.0));
        assert_eq!(caps.freq_range, (20, 20000));
        assert_eq!(caps.q_range, (0.1, 20.0));
    }

    #[test]
    fn validate_name_rejects_unsafe_names() {
        assert!(validate_name("ok name").is_ok());
        assert!(validate_name("trailing.").is_err());
        assert!(validate_name("con").is_err());
        assert!(validate_name("CON.txt").is_err());
        assert!(validate_name("lpt9").is_err());
        assert!(validate_name("com1").is_err());
    }

    #[test]
    fn oversized_profile_is_skipped() {
        let base = temporary_dir();
        let store = ProfileStore::new(&base).unwrap();
        std::fs::write(
            base.join("profiles/Oversized.txt"),
            vec![b'x'; MAX_PROFILE_BYTES as usize + 1],
        )
        .unwrap();

        assert!(store.list().unwrap().is_empty());
        assert!(store.load("Oversized").is_err());

        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn profile_load_preserves_supported_values_and_clamps_absurd_values() {
        let base = temporary_dir();
        let store = ProfileStore::new(&base).unwrap();
        let mut supported = crate::Filter::enabled(0, false);
        supported.gain = 11.0;
        supported.filter_type = FilterType::HighPass;
        let peq = PEQData {
            filters: vec![supported],
            global_gain: -18.0,
        };
        std::fs::write(base.join("profiles/Supported.txt"), peq_to_autoeq(&peq)).unwrap();

        let loaded = store.load("Supported").unwrap().data;
        assert_eq!(loaded.global_gain, -18.0);
        assert_eq!(loaded.filters[0].gain, 11.0);
        assert!(!loaded.filters[0].enabled);
        assert_eq!(loaded.filters[0].filter_type, FilterType::HighPass);

        let mut absurd_filter = crate::Filter::enabled(0, true);
        absurd_filter.freq = u16::MAX;
        absurd_filter.gain = 100.0;
        absurd_filter.q = 100.0;
        let absurd = PEQData {
            filters: vec![absurd_filter],
            global_gain: -100.0,
        };
        std::fs::write(base.join("profiles/Absurd.txt"), peq_to_autoeq(&absurd)).unwrap();
        let loaded = store.load("Absurd").unwrap().data;
        let envelope = storage_capabilities(1);
        assert_eq!(loaded.global_gain, envelope.global_gain_range.0 as f64);
        assert_eq!(loaded.filters[0].gain, envelope.band_gain_range.1);
        assert_eq!(loaded.filters[0].freq, envelope.freq_range.1);
        assert_eq!(loaded.filters[0].q, envelope.q_range.1);

        std::fs::remove_dir_all(base).unwrap();
    }
}
