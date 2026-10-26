import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowAction = "minimize" | "toggleMaximize" | "close";

/** decorum inserts its Windows buttons asynchronously and changes the
 *  maximize glyph on resize. Label them and let CSS render SVGs instead. */
export function labelDecorumControls(): void {
  const bar = document.querySelector("[data-tauri-decorum-tb]");
  if (!bar) return;
  const update = () => {
    bar.querySelectorAll<HTMLButtonElement>(".decorum-tb-btn").forEach((button) => {
      const label = button.id === "decorum-tb-maximize"
        ? (button.textContent === "\uE923" ? "Restore" : "Maximize")
        : button.id === "decorum-tb-close" ? "Close" : "Minimize";
      button.setAttribute("aria-label", label);
    });
  };
  new MutationObserver(update).observe(bar, { childList: true, subtree: true, characterData: true });
  update();
}

/** Tauri's drag region only reacts to mousedown, so start touch and pen
 *  drags ourselves. Only the bare drag surface counts, never its buttons. */
export function enableTouchDrag(root: Document = document): void {
  root.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const target = event.target;
    if (!(target instanceof Element) || !target.hasAttribute("data-tauri-drag-region")) return;
    void getCurrentWindow().startDragging();
  });
}

/** Wire the Linux window buttons in index.html. decorum's own Linux
 *  controls misread KDE's button layout, so they are hidden in CSS. */
export function wireTitlebarControls(root: ParentNode = document): void {
  const win = getCurrentWindow();
  root
    .querySelectorAll<HTMLButtonElement>("[data-window-action]")
    .forEach((button) => {
      const action = button.dataset.windowAction as WindowAction;
      button.addEventListener("click", () => {
        void win[action]();
      });
    });
}
