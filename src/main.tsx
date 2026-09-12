import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isTauri } from "./lib/platform";
import "./styles/base.css";
import "./styles/header.css";
import "./styles/layout.css";
import "./styles/editor.css";
import "./styles/tools.css";
import "./styles/device-selection.css";
import "./styles/responsive.css";
import "./styles/toasts.css";

// Detect Android platform
const isAndroid = /android/i.test(navigator.userAgent);

if (isAndroid) {
  document.body.classList.add("is-android");
}

// Pre-set system theme to prevent flash on cold launch
if (typeof window !== "undefined" && window.matchMedia && !document.documentElement.getAttribute("data-theme")) {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute(
    "data-theme",
    isAndroid ? "material-you" : isDark ? "tokyo-night" : "tokyo-night-day",
  );
}

// Disable default browser context menus and shortcuts in production for a native feel
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
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
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .catch((error) => console.error("Failed to register service worker:", error));
    });
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </React.StrictMode>
);
