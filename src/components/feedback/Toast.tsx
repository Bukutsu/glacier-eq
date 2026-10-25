import "@/lib/i18n";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription } from "@/components/ui/Alert";
import { useToastStore } from "@/stores/toastStore";

export function ToastContainer({
  quiet = false,
  inline = false,
}: {
  quiet?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation("shell");
  const allToasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const pauseToast = useToastStore((s) => s.pauseToast);
  const resumeToast = useToastStore((s) => s.resumeToast);
  const hoverOwner = useId();
  const focusOwner = useId();
  const toasts = quiet
    ? allToasts.filter((toast) => toast.type === "error" || toast.action)
    : allToasts;
  const current =
    [...toasts].reverse().find((toast) => toast.type === "error") ??
    toasts[toasts.length - 1];
  const toastId = current?.id;
  useEffect(
    () => () => {
      if (toastId) {
        resumeToast(toastId, hoverOwner);
        resumeToast(toastId, focusOwner);
      }
    },
    [toastId, hoverOwner, focusOwner, resumeToast],
  );
  if (!current) return null;
  return (
    <Alert
      className={`toast-feedback${inline ? " toast-inline" : ""}`}
      variant={current.type === "error" ? "destructive" : "default"}
      data-type={current.type}
      aria-label={t("feedback.status")}
      role={current.type === "error" ? "alert" : "status"}
      aria-atomic="true"
      key={current.id}
      onMouseEnter={() => pauseToast(current.id, hoverOwner)}
      onMouseLeave={() => resumeToast(current.id, hoverOwner)}
      onFocus={() => pauseToast(current.id, focusOwner)}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          resumeToast(current.id, focusOwner);
      }}
    >
      <Icon
        name={
          current.type === "error"
            ? "error"
            : current.type === "success"
              ? "check"
              : "info"
        }
      />
      <AlertDescription className="toast-message">
        {current.message}
        {current.action && (
          <div className="mt-1">
            <Button
              variant="ghost"
              className="max-[850px]:min-h-11"
              onClick={() => {
                removeToast(current.id);
                current.action?.onClick();
              }}
            >
              {current.action.label}
            </Button>
          </div>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="toast-dismiss size-7! max-[850px]:size-11! pointer-coarse:size-11!"
        aria-label={t("feedback.dismiss")}
        title={t("feedback.dismiss")}
        onClick={() => removeToast(current.id)}
      >
        <Icon name="close" />
      </Button>
    </Alert>
  );
}
