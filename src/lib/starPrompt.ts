// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { i18n } from "@/lib/i18n";
import { openExternalLink } from "@/lib/externalLinks";
import { readLocalStorage, writeLocalStorage } from "@/lib/safeStorage";
import { useToastStore } from "@/stores/toastStore";

const KEY = "glacier-star-prompt";
const REPO_URL = "https://github.com/Bukutsu/glacier-eq";
// Ask only after the app has proven useful: a few real writes to a DAC.
const SAVES_BEFORE_ASKING = 3;
// Let the "saved" toast finish; a new toast would replace it.
const DELAY_MS = 4500;

/**
 * Call after a successful, user-initiated write to real hardware. Asks for a
 * GitHub star exactly once, ever: the counter reaches its limit before the
 * toast shows, so dismissing, clicking or ignoring it all end the same way.
 * If storage is unavailable we never ask, since we could not keep the promise.
 */
export function noteSavedToDac(): void {
  const saves = Number(readLocalStorage(KEY) ?? 0);
  if (!Number.isFinite(saves) || saves < 0 || saves >= SAVES_BEFORE_ASKING)
    return;
  if (!writeLocalStorage(KEY, String(saves + 1))) return;
  if (saves + 1 < SAVES_BEFORE_ASKING) return;
  setTimeout(() => {
    useToastStore.getState().addToast(
      i18n.t("shell:starPrompt.message"),
      "info",
      true,
      {
        label: i18n.t("shell:starPrompt.action"),
        onClick: () => void openExternalLink(REPO_URL),
      },
      "star",
    );
  }, DELAY_MS);
}
