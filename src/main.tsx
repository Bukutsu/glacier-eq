import "@/lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router";
import { SupportedDevicesPage } from "@/features/device/components/SupportedDevicesPage";
import App from "@/app/App";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";
import { isLinux, isTauri } from "@/lib/platform";
import { enableTouchDrag, wireTitlebarControls } from "@/lib/titlebar";
import { runWhenDocumentLoaded } from "@/lib/runWhenDocumentLoaded";
import "@/styles/index.css";

// Detect Android platform
const isAndroid = /android/i.test(navigator.userAgent);

if (isAndroid) {
  document.body.classList.add("is-android");
} else if (isTauri()) {
  document.documentElement.classList.add("native-titlebar");
  enableTouchDrag();
  if (/Macintosh/.test(navigator.userAgent)) {
    document.documentElement.classList.add("macos");
  }
  if (isLinux()) {
    document.documentElement.classList.add("linux");
    wireTitlebarControls();
  }
}

// index.html and boot-theme.js paint the default or cached theme before React.

// Disable default browser context menus and shortcuts in production for a native feel
if (import.meta.env.PROD) {
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

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/supported-devices" element={<SupportedDevicesPage />} />
          <Route path="*" element={<App />} />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  </React.StrictMode>,
);
