import type { ChangeEvent } from "react";

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
}: NumberInputProps) {
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    }
  };

  const decrement = () => {
    if (disabled) return;
    const nextVal = Math.max(min, value - step);
    onChange(Number(nextVal.toFixed(precision)));
  };

  const increment = () => {
    if (disabled) return;
    const nextVal = Math.min(max, value + step);
    onChange(Number(nextVal.toFixed(precision)));
  };

  return (
    <div className={`custom-number-input ${disabled ? "disabled" : ""} ${className}`}>
      <button
        type="button"
        className="stepper-btn decrement"
        onClick={decrement}
        disabled={disabled || value <= min}
        aria-label="Decrement"
      >
        –
      </button>
      <input
        id={id}
        type="number"
        inputMode={precision > 0 ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value.toFixed(precision)}
        onChange={handleInputChange}
        onFocus={onFocus}
        disabled={disabled}
        className="stepper-field"
      />
      <button
        type="button"
        className="stepper-btn increment"
        onClick={increment}
        disabled={disabled || value >= max}
        aria-label="Increment"
      >
        +
      </button>
    </div>
  );
}
