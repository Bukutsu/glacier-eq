import { useEffect } from "react";
import { isAndroidDevice } from "../lib/platform";
import { installKeyboardTapDismissal } from "../lib/keyboardTapDismissal";

export function keyboardViewportHeight(layoutHeight: number, visibleHeight: number, scale: number): number | null {
  // Ignore pinch zoom and small browser/system-bar changes.
  return Math.abs(scale - 1) < 0.01 && layoutHeight - visibleHeight > 120
    ? Math.round(visibleHeight) : null;
}

export function useAndroidKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!isAndroidDevice() || !viewport) return;
    const removeTapDismissal = installKeyboardTapDismissal(document);
    const root = document.documentElement;
    let frame = 0;
    const sync = () => {
      const height = keyboardViewportHeight(window.innerHeight, viewport.height, viewport.scale);
      root.classList.toggle("keyboard-open", height !== null);
      if (height === null) root.style.removeProperty("--app-visible-height");
      else root.style.setProperty("--app-visible-height", `${height}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (height !== null && active instanceof HTMLElement
          && active.matches('input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable="true"]')) {
          active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      });
    };
    sync();
    viewport.addEventListener("resize", sync);
    document.addEventListener("focusin", sync);
    return () => {
      cancelAnimationFrame(frame);
      removeTapDismissal();
      viewport.removeEventListener("resize", sync);
      document.removeEventListener("focusin", sync);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--app-visible-height");
    };
  }, []);
}
