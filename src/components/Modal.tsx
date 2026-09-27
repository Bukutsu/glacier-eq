import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";
import {
  decideModalPopState,
  expectBalanceNavigation,
  isBalanceNavigation,
  modalIdFromState,
  modalStateWithId,
  pushModalEntry,
  removeModalEntry,
  topModalEntry,
  type ModalHistoryEntry,
} from "../lib/modalHistory";

export { MODAL_HISTORY_KEY } from "../lib/modalHistory";

let modalPopstateListenerCount = 0;

function handleModalPopState(event: PopStateEvent) {
  // Our own teardown of a previous modal navigates here too. Acting on it would
  // dismiss whichever dialog the user opened in the meantime.
  if (isBalanceNavigation(event)) return;
  const top = topModalEntry();
  if (top === undefined) return;
  switch (decideModalPopState(event, top)) {
    case "reinsert":
      window.history.pushState(modalStateWithId(top.id, window.history.state), "");
      return;
    case "dismiss":
      removeModalEntry(top);
      top.onClose();
      return;
    case "ignore":
      return;
  }
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

    pushModalEntry(entry);
    window.history.pushState(modalStateWithId(modalId, window.history.state), "");
    if (modalPopstateListenerCount === 0) {
      window.addEventListener("popstate", handleModalPopState);
    }
    modalPopstateListenerCount += 1;
    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      removeModalEntry(entry);
      modalPopstateListenerCount = Math.max(0, modalPopstateListenerCount - 1);
      if (modalPopstateListenerCount === 0) {
        window.removeEventListener("popstate", handleModalPopState);
      }
      // A close button removes the React modal first; balance the sentinel it
      // pushed. If Android Back already removed it, the current state no
      // longer belongs to this entry and no second history navigation occurs.
      if (modalIdFromState(window.history.state) === modalId) {
        // Mark the navigation before it is requested: it resolves after this
        // task, possibly once another dialog has pushed its own sentinel.
        expectBalanceNavigation();
        window.history.back();
      }
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
