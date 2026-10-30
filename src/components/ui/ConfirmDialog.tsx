import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

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
  // Without a host nobody can answer, and the caller would wait forever.
  if (listeners.size === 0)
    return Promise.reject(
      new Error("confirmDialog called with no ConfirmDialogHost mounted"),
    );
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
  const { t } = useTranslation("shell");
  const descriptionId = useId();
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
    <Modal
      title={options.title}
      role="alertdialog"
      descriptionId={descriptionId}
      onClose={() => close(false)}
    >
      <div className="modal-body">
        <p id={descriptionId} className="leg:m-[0] leg:text-[color:var(--text)] leg:text-[length:var(--type-body)] leg:leading-[1.5] leg:whitespace-pre-wrap cmp:[.modal-content_&]:text-[color:var(--muted-foreground)] cmp:[.modal-content_&]:text-[length:var(--type-label)] cmp:[.modal-content_&]:leading-[1.6]">
          {options.message}
        </p>
        <div className="confirm-actions leg:grid leg:grid-cols-[1fr_1fr] leg:gap-[10px] leg:mt-[4px] cmp:[.modal-content_&]:flex cmp:[.modal-content_&]:justify-end cmp:[.modal-content_&]:flex-wrap cmp:[.modal-content_&]:gap-[var(--space-2)] cmp:[.modal-content_&]:mt-[var(--space-4)]">
          <Button autoFocus data-dialog-autofocus onClick={() => close(false)}>
            {options.cancelLabel ?? t("actions.cancel")}
          </Button>
          <Button
            variant={options.danger ? "danger" : "primary"}
            onClick={() => close(true)}
          >
            {options.confirmLabel ?? t("actions.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
