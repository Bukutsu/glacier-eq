import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";

interface CompareHoldButtonProps {
  disabled?: boolean;
  onStart: () => void;
  onEnd: () => void;
}

/**
 * Press and hold to hear the DAC without EQ; release to hear it again.
 * Space and Enter hold it from the keyboard.
 */
export function CompareHoldButton({
  disabled = false,
  onStart,
  onEnd,
}: CompareHoldButtonProps) {
  const { t } = useTranslation("device");
  const [held, setHeld] = useState(false);
  // Pointer up can arrive before React re-renders with held = true.
  const heldRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const begin = () => {
    if (heldRef.current || disabled) return;
    heldRef.current = true;
    setHeld(true);
    onStart();
  };
  const finish = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    onEnd();
  };

  // Never leave the DAC bypassed because the button went away mid-hold.
  useEffect(
    () => () => {
      if (heldRef.current) onEndRef.current();
    },
    [],
  );
  useEffect(() => {
    if (disabled) finish();
  });

  return (
    <button
      type="button"
      className={`leg:inline-flex leg:items-center leg:justify-center leg:min-w-[32px] leg:min-h-[32px] leg:p-[0_var(--space-2)] leg:[border:1px_solid_transparent] leg:rounded-[var(--control-radius)] leg:[font:inherit] leg:[&&]:text-[length:var(--type-small)] leg:[&&]:font-semibold leg:cursor-pointer leg:[&&]:[border-color:var(--input)] leg:[background:var(--control)] leg:text-[color:var(--foreground)] leg:[-webkit-user-select:none] leg:select-none leg:[-webkit-touch-callout:none] leg:[touch-action:none] leg:[&&.active]:[border-color:var(--primary)] leg:[&.active]:[background:var(--primary)] leg:[&.active]:text-[color:var(--primary-foreground)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px] leg:[&:disabled]:opacity-[0.45] leg:[&:disabled]:cursor-not-allowed cmp:compact:[.mobile-workspace_&]:min-w-[var(--touch-md)] cmp:compact:[.mobile-workspace_&]:min-h-[var(--touch-md)] ${held ? " active" : ""}`}
      aria-pressed={held}
      aria-label={t("compareHold.hold")}
      title={t("compareHold.hold")}
      disabled={disabled}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        begin();
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) begin();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        finish();
      }}
      onBlur={finish}
      onContextMenu={(event) => event.preventDefault()}
    >
      {held ? t("compareHold.off") : t("compareHold.label")}
    </button>
  );
}
