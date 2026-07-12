import ReactDOM from "react-dom/client";
import App from "./App";
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

  // Try to read initial insets from Android interface if available
  const androidInsets = (window as any).AndroidInsets;
  if (androidInsets) {
    try {
      const top = androidInsets.getStatusBarHeight();
      const bottom = androidInsets.getNavigationBarHeight();
      if (top > 0) {
        document.documentElement.style.setProperty('--safe-area-inset-top-android', `${top}px`);
      }
      if (bottom > 0) {
        document.documentElement.style.setProperty('--safe-area-inset-bottom-android', `${bottom}px`);
      }
    } catch (e) {
      console.error("Failed to read Android insets interface", e);
    }
  }
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
  <App />
);
