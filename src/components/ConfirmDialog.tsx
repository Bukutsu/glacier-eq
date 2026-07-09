import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

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

  // Enter confirms, Escape cancels while dialog is open
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleAnswer(false);
      else if (e.key === "Enter") handleAnswer(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="confirm-overlay" onClick={() => handleAnswer(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <Icon>warning</Icon>
            </div>
            <p className="confirm-message">{pending.message}</p>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => handleAnswer(false)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-ok" onClick={() => handleAnswer(true)} autoFocus>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
