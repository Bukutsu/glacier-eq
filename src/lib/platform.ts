export const isTauri = () =>
  typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

export const isAndroidDevice = () =>
  typeof navigator !== "undefined" &&
  (/android/i.test(navigator.userAgent) ||
    (typeof document !== "undefined" &&
      document.body.classList.contains("is-android")));
