import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
  document.documentElement.setAttribute("data-theme", isDark ? "tokyo-night" : "tokyo-night-day");
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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error);
    });
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
