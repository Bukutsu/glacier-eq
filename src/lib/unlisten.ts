import type { UnlistenFn } from "@tauri-apps/api/event";

export function safeUnlisten(unlisten: UnlistenFn | null) {
  if (unlisten) {
    try { unlisten(); } catch { /* ignore */ }
  }
}
