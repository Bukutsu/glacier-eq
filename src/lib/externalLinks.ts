// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { openUrl } from "./rpc";
import { useToastStore } from "../stores/toastStore";

/**
 * Opens a link and reports failures where the user can see them. Both
 * openUrl backends can reject (the web backend when the popup is blocked,
 * the desktop backend when the opener command fails); ending in
 * console.error alone left the click looking like it simply did nothing.
 */
export function openExternalLink(href: string): Promise<void> {
  return openUrl(href).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Failed to open external URL:", err);
    useToastStore
      .getState()
      .addToast(`Failed to open external link: ${detail}`, "error");
  });
}

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
      void openExternalLink(href);
    }
  };
}
