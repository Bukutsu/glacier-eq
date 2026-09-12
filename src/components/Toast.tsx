import { Icon } from "./Icon";
import { useToastStore } from "../stores/toastStore";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
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
            onClick={() => removeToast(toast.id)}
            aria-label="Close notification"
          >
            <Icon>close</Icon>
          </button>
        </div>
      ))}
    </div>
  );
}
