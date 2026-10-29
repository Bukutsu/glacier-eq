import "@/lib/i18n";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription } from "@/components/ui/Alert";
import { useToastStore, type Toast } from "@/stores/toastStore";

const ROOT =
  "toast-feedback group absolute! top-[calc(100%+8px)] right-0 z-[var(--z-toast)] grid-cols-[18px_minmax(0,1fr)_auto_28px]! items-center gap-3! w-[420px]! max-w-[calc(100vw-24px)] overflow-hidden border-[var(--border)]! rounded-[var(--radius-surface)]! bg-[var(--popover)]! p-[14px_12px_16px_16px]! text-[var(--popover-foreground)]! shadow-[0_8px_24px_rgb(0_0_0/18%)] touchy:grid-cols-[18px_minmax(0,1fr)_auto_44px]! touchy:gap-2! compact:[.app-header>&]:right-3 [body:has(dialog[open])_.app-header>&]:hidden [&>.app-icon]:m-0! [&>.app-icon]:h-[18px]! [&>.app-icon]:w-[18px]! [&>.app-icon]:text-[var(--ring)]! data-[type=error]:[&>.app-icon]:text-[var(--destructive-foreground)]!";
const INLINE =
  " relative! flex-none w-auto! max-w-none! m-[8px_16px_16px] shadow-none! [dialog:has(.error-notice)_&]:hidden";
const MESSAGE =
  "row-start-1 max-h-[min(160px,25dvh)] overflow-y-auto [overflow-wrap:anywhere] overscroll-contain text-[13px] leading-[1.5] text-[var(--popover-foreground)]! select-text";
const COUNTDOWN =
  "absolute inset-x-0 bottom-0 h-0.5 bg-[rgb(var(--cyan-rgb)/0.1)] motion-reduce:hidden";
const FILL =
  "block h-full w-full origin-left bg-[var(--ring)] opacity-65 group-data-[type=error]:bg-[var(--destructive-foreground)]";

function ToastCountdown({ lifetime }: { lifetime: Toast["lifetime"] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (lifetime.startedAt === null) return;
    const remaining = Math.max(0, lifetime.remaining - (Date.now() - lifetime.startedAt));
    const animation = ref.current?.animate(
      [
        { scale: `${remaining / lifetime.duration} 1` },
        { scale: "0 1" },
      ],
      { duration: remaining, easing: "linear", fill: "forwards" },
    );
    return () => animation?.cancel();
  }, [lifetime]);
  return (
    <span className={COUNTDOWN} aria-hidden="true">
      <span
        ref={ref}
        className={FILL}
        style={{ scale: `${lifetime.remaining / lifetime.duration} 1` }}
      />
    </span>
  );
}

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
      className={ROOT + (inline ? INLINE : "")}
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
      <AlertDescription className={MESSAGE}>
        {current.message}
      </AlertDescription>
      {current.action && (
        <Button
          className="col-start-3 row-start-1 touchy:min-h-[44px]"
          onClick={() => {
            removeToast(current.id);
            current.action?.onClick();
          }}
        >
          {current.action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="col-start-4 row-start-1 size-7! max-[850px]:size-11! pointer-coarse:size-11! [&_.app-icon]:size-[14px]"
        aria-label={t("feedback.dismiss")}
        title={t("feedback.dismiss")}
        onClick={() => removeToast(current.id)}
      >
        <Icon name="close" />
      </Button>
      <ToastCountdown lifetime={current.lifetime} />
    </Alert>
  );
}
