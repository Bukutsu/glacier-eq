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

/// Best-effort removal of temp files orphaned by a crash between creation and
/// rename. Only matches the numeric-nonce naming used by [`atomic_write`]
/// (`{stem}.{nanos}.tmp`) and `ProfileStore::save` (`.{nanos}.tmp`), so real
/// user files that happen to end in `.tmp` are never touched.
pub(crate) fn sweep_stale_temp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("tmp") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        // The nonce is nanoseconds since the Unix epoch (19 digits for the
        // foreseeable future); require a long numeric tail to stay strict.
        let tail = stem.rsplit('.').next().unwrap_or(stem);
        if tail.len() >= 18 && tail.chars().all(|character| character.is_ascii_digit()) {
            let _ = fs::remove_file(&path);
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

    #[test]
    fn sweep_removes_only_crash_orphaned_temp_files() {
        let dir = temporary_dir();
        // Orphans from both temp-naming schemes (19-digit nanosecond nonces).
        fs::write(dir.join("settings.1700000000000000000.tmp"), b"x").unwrap();
        fs::write(dir.join(".1700000000000000000.tmp"), b"x").unwrap();
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
    fn sweep_ignores_missing_directory() {
        sweep_stale_temp_files(Path::new("/definitely/not/a/real/dir/glacier-eq"));
    }
}
