import React, { useState, useEffect } from "react";

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
  const [inputValue, setInputValue] = useState(value.toFixed(precision));

  useEffect(() => {
    setInputValue(value.toFixed(precision));
  }, [value, precision]);

  const handleDecrement = () => {
    if (disabled) return;
    const newVal = Math.max(min, value - step);
    onChange(Number(newVal.toFixed(precision)));
  };

  const handleIncrement = () => {
    if (disabled) return;
    const newVal = Math.min(max, value + step);
    onChange(Number(newVal.toFixed(precision)));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputValue(text);

    const parsed = parseFloat(text);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    }
  };

  const handleBlur = () => {
    setInputValue(value.toFixed(precision));
  };

  return (
    <div className={`custom-number-input ${disabled ? "disabled" : ""} ${className}`}>
      <button
        type="button"
        className="stepper-btn decrement"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label="Decrement"
      >
        <span className="stepper-icon">−</span>
      </button>
      <input
        id={id}
        type="text"
        inputMode={precision > 0 ? "decimal" : "numeric"}
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onFocus={onFocus}
        disabled={disabled}
        className="stepper-field"
      />
      <button
        type="button"
        className="stepper-btn increment"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        aria-label="Increment"
      >
        <span className="stepper-icon">+</span>
      </button>
    </div>
  );
}
