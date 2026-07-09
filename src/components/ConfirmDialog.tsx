import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

interface PendingConfirm {
  message: string;
  resolve: (ok: boolean) => void;
}

interface ConfirmContextType {
  confirm: (message: string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be inside <ConfirmProvider>");
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (message: string): Promise<boolean> =>
      new Promise((resolve) => {
        setPending({ message, resolve });
      }),
    []
  );

  const handleAnswer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal open={!!pending} onClose={() => handleAnswer(false)} title="Confirm">
        <div className="confirm-icon">
          <Icon>warning</Icon>
        </div>
        <p className="confirm-message">{pending?.message}</p>
        <div className="confirm-actions">
            <button className="confirm-btn confirm-btn-cancel" onClick={() => handleAnswer(false)}>
              Cancel
            </button>
            <button className="confirm-btn confirm-btn-ok" onClick={() => handleAnswer(true)} autoFocus>
              Confirm
            </button>
          </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
