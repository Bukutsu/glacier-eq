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
      className={`compare-hold-btn${held ? " active" : ""}`}
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
