// Declared rather than cast: the Tauri runtime injects this global, so
// re-declaring it once here lets the `in` check below narrow for real
// instead of asserting past the type system.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isAndroidDevice = () =>
  typeof navigator !== "undefined" &&
  (/android/i.test(navigator.userAgent) ||
    (typeof document !== "undefined" &&
      document.body.classList.contains("is-android")));

export const isLinux = () =>
  typeof navigator !== "undefined" &&
  /linux/i.test(navigator.userAgent) &&
  !/android/i.test(navigator.userAgent);
