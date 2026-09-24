import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

export const MODAL_HISTORY_KEY = "__glacierModal";

interface ModalHistoryEntry {
  id: string;
  onClose: () => void;
  canClose: () => boolean;
}

// Modal instances share one history stack. A system Back event removes only
// the top entry; returning to an underlying modal's sentinel must not dismiss
// that underlying dialog as well.
const modalHistoryStack: ModalHistoryEntry[] = [];

function modalStateWithId(id: string): Record<string, unknown> {
  const current = window.history.state;
  return typeof current === "object" && current !== null
    ? { ...current, [MODAL_HISTORY_KEY]: id }
    : { [MODAL_HISTORY_KEY]: id };
}

function handleModalPopState(event: PopStateEvent) {
  const top = modalHistoryStack[modalHistoryStack.length - 1];
  if (!top) return;
  const state = event.state;
  const activeId = typeof state === "object" && state !== null
    ? (state as Record<string, unknown>)[MODAL_HISTORY_KEY]
    : undefined;
  // A cleanup already removed the top entry before calling history.back().
  // If the state now names the next entry, that entry is still open.
  if (activeId === top.id) return;
  if (!top.canClose()) {
    // The browser has already moved off the sentinel. Reinsert it so Back
    // cannot bypass a close-disabled operation such as an in-flight save.
    window.history.pushState(modalStateWithId(top.id), "");
    return;
  }
  modalHistoryStack.pop();
  top.onClose();
}

interface ModalProps {
  title: string;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  closeDisabled?: boolean;
}

export function Modal({ title, onClose, className = "", style, children, closeDisabled = false }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const modalId = `modal-${titleId}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: ModalHistoryEntry = {
      id: modalId,
      onClose: () => onCloseRef.current(),
      canClose: () => !closeDisabledRef.current,
    };

    modalHistoryStack.push(entry);
    window.history.pushState(modalStateWithId(modalId), "");
    window.addEventListener("popstate", handleModalPopState);
    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      window.removeEventListener("popstate", handleModalPopState);
      const index = modalHistoryStack.lastIndexOf(entry);
      if (index >= 0) modalHistoryStack.splice(index, 1);
      // A close button removes the React modal first; balance the sentinel it
      // pushed. If Android Back already removed it, the current state no
      // longer belongs to this entry and no second history navigation occurs.
      const state = window.history.state;
      const activeId = typeof state === "object" && state !== null
        ? (state as Record<string, unknown>)[MODAL_HISTORY_KEY]
        : undefined;
      if (activeId === modalId) window.history.back();
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [modalId]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (closeDisabled || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`modal-content${className ? ` ${className}` : ""}`}
      style={style}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => { if (!closeDisabled) onClose(); }}
          disabled={closeDisabled}
          aria-label={`Close ${title}`}
        >
          <Icon>close</Icon>
        </button>
      </div>
      {children}
    </dialog>
  );
}
