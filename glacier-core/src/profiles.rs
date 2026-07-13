// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::autoeq::{parse_autoeq_text, peq_to_autoeq};
use crate::eq::PEQData;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_PROFILE_BYTES: u64 = 1024 * 1024;
const APP_ID: &str = "com.bukutsu.glaciereq";

#[derive(Debug, Clone, serde::Serialize)]
pub struct StoredProfile {
    pub name: String,
    pub data: PEQData,
    pub modified: Option<u64>,
}

pub fn data_dir() -> Result<PathBuf, String> {
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
    let path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".local/share").join(APP_ID));
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
            if let Some(profile) = read_profile(&path)? {
                profiles.push(profile);
            }
        }
        profiles.sort_by_key(|profile| profile.name.to_lowercase());
        Ok(profiles)
    }

    pub fn load(&self, name: &str) -> Result<StoredProfile, String> {
        read_profile(&self.path(name)?)?.ok_or_else(|| format!("Profile not found: {name}"))
    }

    pub fn save(&self, name: &str, peq: &PEQData) -> Result<(), String> {
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
        file.write_all(peq_to_autoeq(peq).as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| {
                format!(
                    "Failed to write temporary profile {}: {error}",
                    temporary.display()
                )
            })?;
        std::fs::rename(&temporary, &path).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            format!("Failed to save profile {}: {error}", path.display())
        })
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        let path = self.path(name)?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to delete {}: {error}", path.display())),
        }
    }

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        validate_name(name)?;
        Ok(self.dir.join(format!("{name}.txt")))
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.trim() != name
        || name.len() > 128
        || !name
            .chars()
            .all(|character| character.is_alphanumeric() || " _-@+&.()".contains(character))
    {
        Err(
            "Profile name contains invalid characters. Use letters, numbers, spaces, and _-@+&.()"
                .into(),
        )
    } else {
        Ok(())
    }
}

fn read_profile(path: &Path) -> Result<Option<StoredProfile>, String> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("txt") {
        return Ok(None);
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to stat {}: {error}", path.display()))?;
    if !metadata.file_type().is_file() {
        return Ok(None);
    }
    if metadata.len() > MAX_PROFILE_BYTES {
        return Ok(None);
    }
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };
    let (data, _, _) = match parse_autoeq_text(&text) {
        Ok(profile) => profile,
        Err(_) => return Ok(None),
    };
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
        store.save("Daily", &replacement).unwrap();
        assert_eq!(store.load("Daily").unwrap().data, replacement);
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.save("../escape", &peq).is_err());
        store.delete("Daily").unwrap();
        assert!(store.list().unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }
}
