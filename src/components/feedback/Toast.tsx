import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";

export function ToastContainer({
  errorsOnly = false,
  inline = false,
}: {
  errorsOnly?: boolean;
  inline?: boolean;
}) {
  const allToasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const pauseToast = useToastStore((s) => s.pauseToast);
  const resumeToast = useToastStore((s) => s.resumeToast);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const toasts = errorsOnly
    ? allToasts.filter((toast) => toast.type === "error")
    : allToasts;
  // Routine feedback must not cover an unresolved failure.
  const current =
    [...toasts].reverse().find((toast) => toast.type === "error") ??
    toasts[toasts.length - 1];
  const paused = hovered || focused;

  useEffect(() => {
    if (!current) return;
    if (paused) pauseToast(current.id);
    else resumeToast(current.id);
    return () => resumeToast(current.id);
  }, [current?.id, paused, pauseToast, resumeToast]);

  if (!current) return null;

  return (
    <section
      className={`toast-feedback${inline ? " inline" : ""}`}
      data-type={current.type}
      aria-label="Status message"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <span className={`toast-icon ${current.type}`}>
        <Icon
          name={
            current.type === "success"
              ? "check"
              : current.type === "error"
                ? "error"
                : "info"
          }
        />
      </span>
      <p
        className="toast-message"
        role={current.type === "error" ? "alert" : "status"}
        aria-atomic="true"
        key={current.id}
      >
        {current.message}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="toast-dismiss"
        aria-label="Dismiss message"
        title="Dismiss message"
        onClick={() => removeToast(current.id)}
      >
        <Icon name="close" />
      </Button>
    </section>
  );
}
