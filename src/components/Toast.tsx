import { Icon } from "./Icon";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "error" | "success";
}

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-item ${toast.type}`}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
          <span className="toast-icon">
            <Icon>{toast.type === "success" ? "check_circle" : toast.type === "error" ? "error" : "info"}</Icon>
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onClose(toast.id)}
            aria-label="Close notification"
          >
            <Icon>close</Icon>
          </button>
        </div>
      ))}
    </div>
  );
}
