// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { openUrl } from "./rpc";

/**
 * Document-level click handler that opens http(s) anchors in the default
 * browser (Tauri webviews navigate in-place otherwise).
 *
 * Components may handle a link themselves first (ExternalLinkRow calls
 * preventDefault in its React onClick, which runs at the React root before
 * the event reaches document). Without the defaultPrevented guard that
 * handled click bubbled on and opened the URL a second time — two tabs per
 * click. Anchors with no own handler still fall through to this one.
 */
export function createExternalLinkClickHandler(): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      event.preventDefault();
      openUrl(href).catch((err) => {
        console.error("Failed to open external URL:", err);
      });
    }
  };
}
