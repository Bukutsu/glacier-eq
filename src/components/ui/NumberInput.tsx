import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "./Button";
import { parseNumericInput } from "@/lib/numericInput";
import { useToastStore } from "@/stores/toastStore";

interface NumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
  /** Step from the committed value or a valid draft, e.g. along a snapped grid. */
  onStep?: (direction: 1 | -1, largeStep: boolean, value: number) => void;
  disabled?: boolean;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  "aria-label"?: string;
}

export function NumberInput({
  id,
  value,
  min = 0,
  max = 100,
  step = 1,
  precision = 0,
  onChange,
  onStep,
  disabled = false,
  className = "",
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const { t } = useTranslation("shell");
  // Draft keeps the raw string while typing (e.g. "1." for an in-progress
  // decimal) so the field isn't reformatted on every keystroke; the value is
  // parsed/clamped and committed on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = parseNumericInput(raw);
    if (parsed !== null) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    } else {
      useToastStore.getState().setStatus(t("number.invalid"), "error");
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
  };

  const handleBlur = () => {
    if (draft !== null) commit(draft);
    setDraft(null);
    onBlur?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Blur owns the commit, including validation and the editing boundary.
      e.preventDefault();
      e.currentTarget.blur();
    } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
      e.preventDefault();
      stepValue(
        e.key === "ArrowUp" || e.key === "PageUp" ? 1 : -1,
        e.key === "PageUp" || e.key === "PageDown",
      );
    }
  };

  const stepValue = (direction: 1 | -1, largeStep: boolean) => {
    if (disabled) return;
    const parsed = draft === null ? value : parseNumericInput(draft);
    if (parsed === null) {
      useToastStore.getState().setStatus(t("number.invalid"), "error");
      return;
    }
    const current = Number(
      Math.max(min, Math.min(max, parsed)).toFixed(precision),
    );
    onFocus?.();
    setDraft(null);
    if (onStep) {
      onStep(direction, largeStep, current);
    } else {
      const next = Math.max(
        min,
        Math.min(max, current + direction * step * (largeStep ? 10 : 1)),
      );
      onChange(Number(next.toFixed(precision)));
    }
    onBlur?.();
  };

  const displayValue = draft ?? value.toFixed(precision);

  return (
    <div
      className={`custom-number-input ${disabled ? "disabled" : ""} ${className}`}
    >
      <Button
        variant="ghost"
        size="icon"
        className="stepper-btn decrement"
        onClick={() => stepValue(-1, false)}
        disabled={disabled || value <= min}
        aria-label={
          ariaLabel
            ? t("number.decrease", { label: ariaLabel })
            : t("number.decrement")
        }
      >
        <Minus aria-hidden="true" />
      </Button>
      <input
        id={id}
        type="text"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : min}
        aria-valuetext={displayValue}
        inputMode={precision > 0 ? "decimal" : "numeric"}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        aria-label={ariaLabel}
        disabled={disabled}
        className="stepper-field"
      />
      <Button
        variant="ghost"
        size="icon"
        className="stepper-btn increment"
        onClick={() => stepValue(1, false)}
        disabled={disabled || value >= max}
        aria-label={
          ariaLabel
            ? t("number.increase", { label: ariaLabel })
            : t("number.increment")
        }
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
