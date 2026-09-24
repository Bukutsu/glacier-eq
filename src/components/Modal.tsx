import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

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

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

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
