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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);

