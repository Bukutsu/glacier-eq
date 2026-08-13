import { useState, type ChangeEvent, type KeyboardEvent } from "react";

interface NumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  onFocus?: () => void;
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
  disabled = false,
  className = "",
  onFocus,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  // Draft keeps the raw string while typing (e.g. "1." for an in-progress
  // decimal) so the field isn't reformatted on every keystroke; the value is
  // parsed/clamped and committed on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    commit(e.target.value);
  };

  const handleBlur = () => {
    if (draft !== null) commit(draft);
    setDraft(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (draft !== null) commit(draft);
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  const decrement = () => {
    if (disabled) return;
    onFocus?.();
    setDraft(null);
    const nextVal = Math.max(min, value - step);
    onChange(Number(nextVal.toFixed(precision)));
  };

  const increment = () => {
    if (disabled) return;
    onFocus?.();
    setDraft(null);
    const nextVal = Math.min(max, value + step);
    onChange(Number(nextVal.toFixed(precision)));
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
