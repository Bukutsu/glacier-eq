// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export const DEFAULT_PROFILE_NAME = "Default EQ";

/** A reserved profile name also remains reserved with a file extension. */
export function isReservedProfileName(name: string): boolean {
  return (
    profileIdentityKey(name.split(".", 1)[0]) ===
    profileIdentityKey(DEFAULT_PROFILE_NAME)
  );
}

/**
 * Canonical case-insensitive identity for profile names, mirroring
 * ProfileStore::path's `eq_ignore_ascii_case` (glacier-core/src/profiles.rs):
 * only ASCII A-Z folds, everything else — including locale-sensitive I/ı
 * and Unicode É/é — compares verbatim. `toLowerCase`/`toLocaleLowerCase`
 * here would let the UI, the web backend, and the desktop filesystem
 * disagree about whether two names are the same profile.
 */
export function profileIdentityKey(name: string): string {
  return name.replace(/[A-Z]/g, (character) => character.toLowerCase());
}
