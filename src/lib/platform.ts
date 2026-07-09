export const isTauri = () =>
  typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

/** Cross-platform confirm dialog. Uses Tauri native dialog when available, falls back to window.confirm. */
export async function confirmAsync(message: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      return await ask(message, { kind: "warning" });
    } catch {
      // Fall through to window.confirm
    }
  }
  return window.confirm(message);
}
