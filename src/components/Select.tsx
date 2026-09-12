// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { Icon } from "./Icon";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: SelectProps<T>) {
  return (
    <div className={`custom-select-container ${disabled ? "disabled" : ""} ${className}`.trim()}>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const coerced =
            options.length > 0 && typeof options[0].value === "number"
              ? (Number(raw) as T)
              : (raw as T);
          onChange(coerced);
        }}
        disabled={disabled}
        className="custom-select-trigger"
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          paddingRight: "30px",
          width: "100%",
        }}
      >
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            style={{ background: "var(--panel)", color: "var(--text)" }}
          >
            {opt.label}
          </option>
        ))}
      </select>
      <span className="custom-select-arrow" style={{ pointerEvents: "none" }}>
        <Icon>expand_more</Icon>
      </span>
    </div>
  );
}
