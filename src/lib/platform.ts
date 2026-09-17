export const isTauri = () =>
  typeof window !== "undefined" &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export const isAndroidDevice = () =>
  typeof navigator !== "undefined" &&
  (/android/i.test(navigator.userAgent) ||
    (typeof document !== "undefined" &&
      document.body.classList.contains("is-android")));

export const isLinux = () =>
  typeof navigator !== "undefined" &&
  /linux/i.test(navigator.userAgent) &&
  !/android/i.test(navigator.userAgent);
