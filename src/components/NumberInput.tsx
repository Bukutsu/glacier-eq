import React from "react";

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
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    }
  };

  return (
    <div className={`custom-number-input ${disabled ? "disabled" : ""} ${className}`}>
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
    </div>
  );
}
