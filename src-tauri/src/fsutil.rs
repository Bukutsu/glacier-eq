// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Crash-safe file replacement: write to a unique sibling temp file, sync,
//! then rename over the destination. Shared by settings persistence and user
//! text-file exports.

use std::fs;
use std::io::Write;
use std::path::Path;

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

    /// Backdate a file past [`STALE_TEMP_AGE`] so the sweep considers it.
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
        let settingsOrphan = dir.join("settings.1700000000000000000.tmp");
        let profileOrphan = dir.join(".1700000000000000000.tmp");
        fs::write(&settingsOrphan, b"x").unwrap();
        fs::write(&profileOrphan, b"x").unwrap();
        set_stale(&settingsOrphan);
        set_stale(&profileOrphan);
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
}
