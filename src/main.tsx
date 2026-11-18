import { i18nReady } from "@/lib/i18n";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { useLocation } from "@/lib/router";
import App from "@/app/App";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";
import { isAndroidDevice, isLinux, isTauri } from "@/lib/platform";
import { enableTouchDrag, labelDecorumControls, wireTitlebarControls } from "@/lib/titlebar";
import { runWhenDocumentLoaded } from "@/lib/runWhenDocumentLoaded";
import "@/styles/index.css";

const SupportedDevicesPage = lazy(() =>
  import("@/features/device/components/SupportedDevicesPage").then(
    ({ SupportedDevicesPage }) => ({ default: SupportedDevicesPage }),
  ),
);

if (isAndroidDevice()) {
  document.body.classList.add("is-android");
} else if (isTauri()) {
  document.documentElement.classList.add("native-titlebar");
  enableTouchDrag();
  labelDecorumControls();
  if (/Macintosh/.test(navigator.userAgent)) {
    document.documentElement.classList.add("macos");
  }
  if (isLinux()) {
    document.documentElement.classList.add("linux");
    wireTitlebarControls();
  }
}

// index.html and boot-theme.js paint the default or cached theme before React.

// Disable default browser context menus and shortcuts in the packaged app for
// a native feel. The hosted web build keeps reload, print and the context menu.
if (import.meta.env.PROD && isTauri()) {
  document.addEventListener("contextmenu", (e) => {
    if (window.location.hash.startsWith("#/supported-devices")) return;
    // Preserve Android's select/copy/paste menu inside editable fields.
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (window.location.hash.startsWith("#/supported-devices")) return;
    const key = e.key.toLowerCase();
    if (
      key === "f5" ||
      ((e.ctrlKey || e.metaKey) && (key === "r" || key === "p"))
    ) {
      e.preventDefault();
    }
  });
}

if (import.meta.env.PROD) {
  // Tauri serves the app from tauri.localhost, where service workers are
  // unsupported. Register only for the hosted web/PWA build.
  if ("serviceWorker" in navigator && !isTauri()) {
    runWhenDocumentLoaded(
      document.readyState,
      (callback) => window.addEventListener("load", callback, { once: true }),
      () => {
        navigator.serviceWorker
          .register(`${import.meta.env.BASE_URL}sw.js`)
          .catch((error) =>
            console.error("Failed to register service worker:", error),
          );
      },
    );
  }
}

// Checked rather than asserted: nothing in the type system ties this id to
// index.html, and createRoot throws before ErrorBoundary is mounted, so a
// desync is a bare white screen with no recovery UI.
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

await i18nReady;

function Routes() {
  const { pathname } = useLocation();
  if (pathname.replace(/\/+$/, "") === "/supported-devices")
    return (
      <Suspense fallback={null}>
        <SupportedDevicesPage />
      </Suspense>
    );
  return <App />;
}

// The hosted build ships a static snapshot of the first screen (see
// scripts/prerender.mjs) so slow links see the app before the scripts arrive.
// Preact renders synchronously, so removing it here never shows a blank frame.
document.getElementById("prerender")?.remove();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Routes />
    </ErrorBoundary>
  </React.StrictMode>,
);
