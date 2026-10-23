import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription } from "@/components/ui/Alert";
import { useToastStore } from "@/stores/toastStore";

export function ToastContainer({
  errorsOnly = false,
  inline = false,
}: {
  errorsOnly?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation("shell");
  const allToasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const toasts = errorsOnly
    ? allToasts.filter((toast) => toast.type === "error")
    : allToasts;
  const current =
    [...toasts].reverse().find((toast) => toast.type === "error") ??
    toasts[toasts.length - 1];
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
