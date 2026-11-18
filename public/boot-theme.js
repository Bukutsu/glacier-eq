// Restore the last painted theme before the application bundle loads.
// Also hide the prerendered first screen (hosted web build) when it would be
// wrong or pointless; the boot logo shows instead.
(() => {
  try {
    const stored = localStorage.getItem("glacier.language");
    const language = stored && stored !== "system" ? stored : navigator.language;
    const route = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    if (
      !/^en(-|$)/i.test(language || "")
      || !["", "eq"].includes(route)
      || navigator.serviceWorker?.controller
    ) {
      document.documentElement.classList.add("no-prerender");
    }
  } catch {
    document.documentElement.classList.add("no-prerender");
  }
})();

(() => {
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      && typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) {
      document.documentElement.classList.add("native-android-boot");
    }
    const raw = localStorage.getItem("glacier-boot-theme");
    if (!raw || raw.length > 2048) return;
    const cached = JSON.parse(raw);
    if (typeof cached.background !== "string"
      || !/^(#[0-9a-f]{3,8}|rgba?\([0-9.,% /]+\))$/i.test(cached.background)
      || typeof cached.theme !== "string" || !/^[a-z-]{1,40}$/.test(cached.theme)
      || !["light", "dark"].includes(cached.colorScheme)) return;
    const root = document.documentElement;
    root.dataset.theme = cached.theme;
    root.style.setProperty("--boot-background", cached.background);
    root.style.colorScheme = cached.colorScheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cached.background);
  } catch {
    // A missing or damaged cache must never prevent launch.
  }
})();
