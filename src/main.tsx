import ReactDOM from "react-dom/client";
import App from "./App";

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
    if (
      e.key === "F5" ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p")
    ) {
      e.preventDefault();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);

