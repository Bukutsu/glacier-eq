import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowAction = "minimize" | "toggleMaximize" | "close";

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
