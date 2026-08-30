import { useState, type ChangeEvent, type KeyboardEvent } from "react";

interface NumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
  /** When set, stepper interactions (buttons/arrows/PageUp/Down) call this
   *  instead of applying value ± step, letting the parent guarantee progress
   *  (e.g. stepping along a snapped grid). Typed input still goes to onChange. */
  onStep?: (direction: 1 | -1, largeStep: boolean) => void;
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
  // Draft keeps the raw string while typing (e.g. "1." for an in-progress
  // decimal) so the field isn't reformatted on every keystroke; the value is
  // parsed/clamped and committed on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    const parsed = Number.parseFloat(e.target.value);
    // Only live-commit if the parsed number is fully within bounds without forced premature clamping
    if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      onChange(Number(parsed.toFixed(precision)));
    }
  };

  const handleBlur = () => {
    if (draft !== null) commit(draft);
    setDraft(null);
    onBlur?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (draft !== null) commit(draft);
      setDraft(null);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      increment();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      decrement();
    } else if (e.key === "PageUp") {
      e.preventDefault();
      if (disabled) return;
      onFocus?.();
      setDraft(null);
      if (onStep) {
        onStep(1, true);
      } else {
        const largeStep = step * 10;
        const nextVal = Math.min(max, value + largeStep);
        onChange(Number(nextVal.toFixed(precision)));
      }
      onBlur?.();
    } else if (e.key === "PageDown") {
      e.preventDefault();
      if (disabled) return;
      onFocus?.();
      setDraft(null);
      if (onStep) {
        onStep(-1, true);
      } else {
        const largeStep = step * 10;
        const nextVal = Math.max(min, value - largeStep);
        onChange(Number(nextVal.toFixed(precision)));
      }
      onBlur?.();
    }
  };

  const decrement = () => {
    if (disabled) return;
    onFocus?.();
    setDraft(null);
    if (onStep) {
      onStep(-1, false);
      onBlur?.();
      return;
    }
    const nextVal = Math.max(min, value - step);
    onChange(Number(nextVal.toFixed(precision)));
    onBlur?.();
  };

  const increment = () => {
    if (disabled) return;
    onFocus?.();
    setDraft(null);
    if (onStep) {
      onStep(1, false);
      onBlur?.();
      return;
    }
    const nextVal = Math.min(max, value + step);
    onChange(Number(nextVal.toFixed(precision)));
    onBlur?.();
  };

  const displayValue = draft ?? value.toFixed(precision);

  return (
    <div className={`custom-number-input ${disabled ? "disabled" : ""} ${className}`}>
      <button
        type="button"
        className="stepper-btn decrement"
        onClick={decrement}
        disabled={disabled || value <= min}
        aria-label={ariaLabel ? `Decrease ${ariaLabel}` : "Decrement"}
      >
        –
      </button>
      <input
        id={id}
        type="text"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : min}
        aria-valuetext={displayValue}
        inputMode={precision > 0 ? "decimal" : "numeric"}
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
      <button
        type="button"
        className="stepper-btn increment"
        onClick={increment}
        disabled={disabled || value >= max}
        aria-label={ariaLabel ? `Increase ${ariaLabel}` : "Increment"}
      >
        +
      </button>
    </div>
  );
}
