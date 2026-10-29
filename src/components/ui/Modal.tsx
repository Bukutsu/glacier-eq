import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { Icon } from "./Icon";
import { ToastContainer } from "@/components/feedback/Toast";
import { Button } from "./Button";
import {
  decideModalPopState,
  expectBalanceNavigation,
  isBalanceNavigation,
  modalIdFromState,
  modalStateWithId,
  pushModalEntry,
  removeModalEntry,
  topModalEntry,
  type ModalHistoryEntry,
} from "@/lib/modalHistory";

export { MODAL_HISTORY_KEY } from "@/lib/modalHistory";

let modalPopstateListenerCount = 0;

function handleModalPopState(event: PopStateEvent) {
  // Our own teardown of a previous modal navigates here too. Acting on it would
  // dismiss whichever dialog the user opened in the meantime.
  if (isBalanceNavigation(event)) return;
  const top = topModalEntry();
  if (top === undefined) return;
  const action = decideModalPopState(event, top);
  switch (action) {
    case "reinsert":
      window.history.pushState(
        modalStateWithId(top.id, window.history.state),
        "",
      );
      return;
    case "dismiss":
      removeModalEntry(top);
      top.onClose();
      return;
    case "ignore":
      return;
    default: {
      // A new popstate action must be handled here, not silently fall through
      // and leave the Back press doing nothing. Verified: adding a fourth
      // member to ModalPopStateAction compiled clean before this arm existed.
      const exhaustive: never = action;
      throw new Error(`unhandled modal popstate action: ${exhaustive}`);
    }
  }
}

interface ModalProps {
  title: string;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  closeDisabled?: boolean;
  descriptionId?: string;
  role?: "dialog" | "alertdialog";
}

export function Modal({
  title,
  onClose,
  className = "",
  style,
  children,
  closeDisabled = false,
  descriptionId,
  role,
}: ModalProps) {
  const { t } = useTranslation("shell");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const modalId = `modal-${titleId}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const entry: ModalHistoryEntry = {
      id: modalId,
      onClose: () => onCloseRef.current(),
      canClose: () => !closeDisabledRef.current,
    };

    pushModalEntry(entry);
    window.history.pushState(
      modalStateWithId(modalId, window.history.state),
      "",
    );
    if (modalPopstateListenerCount === 0) {
      window.addEventListener("popstate", handleModalPopState);
    }
    modalPopstateListenerCount += 1;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // React/Base UI autofocus can run before the native dialog is open.
      // Apply the requested initial focus only after it enters the top layer.
      dialog
        .querySelector<HTMLElement>("[data-dialog-autofocus]:not(:disabled)")
        ?.focus();
    }

    return () => {
      removeModalEntry(entry);
      modalPopstateListenerCount = Math.max(0, modalPopstateListenerCount - 1);
      if (modalPopstateListenerCount === 0) {
        window.removeEventListener("popstate", handleModalPopState);
      }
      // A close button removes the React modal first; balance the sentinel it
      // pushed. If Android Back already removed it, the current state no
      // longer belongs to this entry and no second history navigation occurs.
      if (modalIdFromState(window.history.state) === modalId) {
        // Mark the navigation before it is requested: it resolves after this
        // task, possibly once another dialog has pushed its own sentinel.
        expectBalanceNavigation();
        window.history.back();
      }
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [modalId]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (closeDisabled || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`modal-content leg:[dialog&]:[background:var(--popover)] leg:[dialog&]:[border:1px_solid_var(--border)] leg:[dialog&]:rounded-[var(--radius-card)] leg:[dialog&]:box-border leg:[dialog&]:text-[color:var(--text)] leg:[dialog&]:fixed leg:[dialog&]:inset-[0] leg:[dialog&]:m-[auto] leg:[dialog&]:w-[min(480px,_calc(100vw_-_32px_-_var(--safe-area-left,_0px)_-_var(--safe-area-right,_0px)))] leg:[dialog&]:max-w-[none] leg:[dialog&]:max-h-[min(85vh,_calc(100dvh_-_32px_-_var(--safe-area-top,_0px)_-_var(--safe-area-bottom,_0px)))] leg:[dialog&]:overflow-y-auto leg:[dialog&]:[overscroll-behavior:contain] leg:[dialog&]:[-webkit-overflow-scrolling:touch] leg:[dialog&]:p-[0] leg:[dialog&]:[box-shadow:0_16px_48px_rgba(0,_0,_0,_0.5)] leg:[dialog&]:flex-col leg:[dialog&]:[animation:modal-scale-in_var(--motion-duration)_var(--motion-ease)] leg:[dialog&[open]]:flex leg:[dialog&::backdrop]:[background:rgba(var(--bg-darker-rgb),_0.75)] leg:[dialog&::backdrop]:[backdrop-filter:blur(4px)] leg:[dialog&::backdrop]:[animation:motion-fade-in_var(--motion-duration)_var(--motion-ease)] leg:[dialog&.wide]:w-[min(680px,_96vw)] leg:[dialog&.device-modal]:h-[fit-content] leg:[dialog&.device-modal]:max-h-[calc(100dvh_-_64px)] leg:[dialog&.device-modal]:overflow-hidden leg:compact:[dialog&&]:w-[calc(100vw_-_16px_-_var(--safe-area-left,_0px)_-_var(--safe-area-right,_0px))] leg:compact:[dialog&&]:max-h-[calc(100dvh_-_16px_-_var(--safe-area-top,_0px)_-_var(--safe-area-bottom,_0px))] leg:compact:[dialog&&.wide]:w-[calc(100vw_-_16px_-_var(--safe-area-left,_0px)_-_var(--safe-area-right,_0px))] leg:compact:[dialog&&.wide]:max-h-[calc(100dvh_-_16px_-_var(--safe-area-top,_0px)_-_var(--safe-area-bottom,_0px))] leg:compact:[dialog&.device-modal]:inset-[auto_0_0] leg:compact:[dialog&.device-modal]:m-[0_auto] leg:compact:[dialog&&&.device-modal]:w-[calc(100vw_-_var(--safe-area-left,_0px)_-_var(--safe-area-right,_0px))] leg:compact:[dialog&&.device-modal]:h-[auto] leg:compact:[dialog&&&.device-modal]:max-h-[calc(100dvh_-_var(--safe-area-top,_0px)_-_8px)] leg:compact:[dialog&.device-modal]:rounded-[16px_16px_0_0] leg:compact:[dialog&.device-modal]:[border-bottom:0] leg:compact:[dialog&]:[scrollbar-width:none] leg:[dialog&&&&.add-trace-modal]:w-[min(640px,_calc(100vw_-_32px_-_var(--safe-area-left,_0px)_-_var(--safe-area-right,_0px)))] leg:[dialog&.add-trace-modal]:p-[0] cmp:[dialog&]:text-[color:var(--popover-foreground)] cmp:[dialog&]:[border-color:var(--border)] cmp:[dialog&]:[background:var(--popover)] cmp:[dialog&]:[box-shadow:var(--shadow-md)] cmp:[dialog&]:[animation:motion-fade-in_var(--motion-duration)_var(--motion-ease)] cmp:[dialog&::backdrop]:[background:rgb(0_0_0_/_0.45)] cmp:[dialog&::backdrop]:[backdrop-filter:none] cmp:motion-reduce:[dialog&&]:[animation:none] cmp:motion-reduce:[dialog&::backdrop]:[animation:none] cmp:compact:[.keyboard-open_dialog&]:[inset-block:0_calc(100dvh_-_var(--app-visible-height,_100dvh))] cmp:compact:[.keyboard-open_dialog&]:max-h-[calc(var(--app-visible-height,_100dvh)_-_var(--safe-area-top,_0px)_-_var(--space-4))] ${className ? ` ${className}` : ""}`}
      style={style}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      role={role}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div className="modal-header leg:flex leg:items-center leg:justify-between leg:p-[14px_16px_10px] leg:[border-bottom:1px_solid_var(--line-soft)] leg:shrink-0 leg:compact:sticky leg:compact:top-[0] leg:compact:z-[1] leg:compact:pt-[calc(14px_+_var(--safe-area-top,_0px))] leg:compact:[background:var(--panel)] leg:compact:[.device-modal_&]:p-[var(--space-4)] leg:compact:[.device-modal_&&]:pt-[var(--space-4)] leg:[.add-trace-modal_&&]:p-[16px_20px] leg:[.add-trace-modal_&]:gap-[12px] leg:max-[540px]:[.add-trace-modal_&&&]:p-[12px_16px] cmp:[.modal-content_&]:gap-[var(--space-4)] cmp:[.modal-content_&]:p-[var(--space-5)_var(--space-5)_var(--space-3)] cmp:[.modal-content_&]:[border-bottom:0] cmp:[.modal-content_&]:[background:var(--popover)] cmp:compact:[.modal-content_&&]:p-[var(--space-4)]">
        <h2 id={titleId}>{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="cmp:[.modal-content_&]:m-[-6px_-6px_-6px_0]"
          onClick={() => {
            if (!closeDisabled) onClose();
          }}
          disabled={closeDisabled}
          aria-label={t("actions.close", { title })}
        >
          <Icon name="close" />
        </Button>
      </div>
      {children}
      <ToastContainer quiet inline />
    </dialog>
  );
}
