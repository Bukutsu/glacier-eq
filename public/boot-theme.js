// Restore the last painted theme before the application bundle loads.
(() => {
  try {
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
