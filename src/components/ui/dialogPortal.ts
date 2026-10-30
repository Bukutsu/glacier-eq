import { useCallback, useRef } from "react";

/**
 * Portal container for popups anchored to an element. Native modal dialogs
 * live in the top layer, above anything portaled to document.body, so a popup
 * opened from inside one must portal into that dialog instead.
 *
 * Pass `anchor` as the trigger's ref: it resolves during the trigger commit,
 * before an opened Portal runs its layout effect.
 */
export function useDialogPortal() {
  const container = useRef<HTMLElement | null>(null);
  const anchor = useCallback((element: Element | null) => {
    container.current = element
      ? (element.closest("dialog") ?? element.ownerDocument.body)
      : null;
  }, []);
  return { container, anchor };
}
