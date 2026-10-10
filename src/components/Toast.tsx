import { useEffect, useId, useState } from "react";
import { Icon } from "./Icon";
import { useToastStore, type Toast } from "../stores/toastStore";

function ToastMessage({ toast, announce = false }: { toast: Toast; announce?: boolean }) {
  return (
    <>
      <span className={`toast-icon ${toast.type}`}>
        <Icon name={toast.type === "success" ? "check" : toast.type === "error" ? "error" : "info"} />
      </span>
      <span className="toast-message"
        role={announce ? (toast.type === "error" ? "alert" : "status") : undefined}
        aria-atomic={announce ? true : undefined}>
        {toast.message}
      </span>
    </>
  );
}

export function ToastContainer() {
  const toasts = useToastStore(s => s.toasts);
  const removeToast = useToastStore(s => s.removeToast);
  const pauseToast = useToastStore(s => s.pauseToast);
  const resumeToast = useToastStore(s => s.resumeToast);
  const [showEarlier, setShowEarlier] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const historyId = useId();
  // Show the newest error first. Routine feedback must not cover a failure.
  const current = [...toasts].reverse().find(toast => toast.type === "error") ?? toasts[toasts.length - 1];
  const earlier = toasts.filter(toast => toast.id !== current?.id);
  const paused = hovered || focused;

  useEffect(() => {
    if (!current) return;
    if (paused) pauseToast(current.id);
    else resumeToast(current.id);
    return () => resumeToast(current.id);
  }, [current?.id, paused, pauseToast, resumeToast]);

  useEffect(() => {
    if (toasts.length === 0) {
      setShowEarlier(false);
      setExpanded(false);
      setHovered(false);
      setFocused(false);
    }
  }, [toasts.length]);

  if (!current) return <div className="toast-slot" />;

  return (
    <div className="toast-slot has-toast">
      <section className={`toast-container${expanded || showEarlier ? " expanded" : ""}`} aria-label="Status messages"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}>
        <div className="toast-item">
          <button type="button" className="toast-summary" aria-expanded={expanded}
            aria-label={expanded ? "Collapse notification" : "Show full notification"} onClick={() => setExpanded(value => !value)}>
            <ToastMessage toast={current} announce />
          </button>
          {earlier.length > 0 && (
            <button type="button" className="toast-earlier" aria-expanded={showEarlier} aria-controls={historyId}
              aria-label={showEarlier ? "Hide earlier messages" : `Show ${earlier.length} other messages`}
              onClick={() => setShowEarlier(value => !value)}>
              {showEarlier ? "Less" : `${earlier.length} more`}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => removeToast(current.id)} aria-label="Dismiss toast">
            <Icon name="close" />
          </button>
        </div>
        {earlier.length > 0 && (
          <div id={historyId} className="toast-history" hidden={!showEarlier}>
            {earlier.map(toast => (
              <div className="toast-item" key={toast.id}>
                <ToastMessage toast={toast} />
                <button type="button" className="toast-close" onClick={() => removeToast(toast.id)}
                  aria-label={`Dismiss toast: ${toast.message}`}>
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
