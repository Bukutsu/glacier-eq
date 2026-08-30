import { useEffect, useState } from "react";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Resolver = (confirmed: boolean) => void;

// Module-level singleton so any component can request a confirmation without
// prop-drilling a callback through the tree. A single <ConfirmDialogHost> is
// mounted at the app root and subscribes to these requests.
let pendingResolver: Resolver | null = null;
const listeners = new Set<(options: ConfirmOptions | null) => void>();

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (pendingResolver) {
    // A dialog is already open; resolve it as cancelled before replacing it.
    pendingResolver(false);
    pendingResolver = null;
  }
  return new Promise<boolean>((resolve) => {
    pendingResolver = resolve;
    listeners.forEach((listener) => listener(options));
  });
}

export function ConfirmDialogHost() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  useEffect(() => {
    const listener = (next: ConfirmOptions | null) => setOptions(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (pendingResolver) {
        pendingResolver(false);
        pendingResolver = null;
      }
    };
  }, []);

  const close = (confirmed: boolean) => {
    setOptions(null);
    if (pendingResolver) {
      pendingResolver(confirmed);
      pendingResolver = null;
    }
  };

  if (!options) return null;

  return (
    <Modal title={options.title} onClose={() => close(false)}>
      <div className="modal-body">
        <p className="confirm-message">{options.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn" autoFocus onClick={() => close(false)}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={options.danger ? "btn confirm-danger" : "btn filled"}
            onClick={() => close(true)}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
