import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Contract for any modal in the app.
 * Every new modal must accept these props. Add domain-specific props on top.
 */
export interface ModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when user requests close (Escape, click outside, close button). */
  onClose: () => void;
  /** Optional header title. */
  title?: string;
  /** Optional variant. */
  variant?: "wide";
  /** Modal content. */
  children: ReactNode;
}

export function Modal({ open, onClose, title, variant, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const contentClass = variant === "wide" ? "modal-content wide" : "modal-content";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={contentClass} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <Icon>close</Icon>
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
