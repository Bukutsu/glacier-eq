// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useRef, type CSSProperties } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Icon } from "./Icon";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  className = "",
  style,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps<T>) {
  const portalContainer = useRef<HTMLElement | null>(null);
  // Resolve during the trigger commit, before an opened Portal runs its layout
  // effect. Native dialogs live in the top layer, above document.body portals.
  const triggerRef = useCallback((trigger: HTMLButtonElement | null) => {
    portalContainer.current = trigger
      ? trigger.closest("dialog") ?? trigger.ownerDocument.body
      : null;
  }, []);
  // Like a native single select, show the first enabled option when the
  // controlled value isn't present (for example, while targets are loading).
  const selectedValue = options.some((option) => option.value === value)
    ? value
    : options.find((option) => !option.disabled)?.value ?? null;

  return (
    <BaseSelect.Root<T>
      id={id}
      name={id}
      autoComplete="off"
      value={selectedValue}
      items={options}
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (disabled || nextValue === null || nextValue === selectedValue) return;
        const option = options.find((item) => item.value === nextValue);
        if (!option || option.disabled) return;
        onChange(nextValue);
      }}
    >
      <div className={`app-select ${disabled ? "disabled" : ""} ${className}`.trim()} style={style}>
        <BaseSelect.Trigger
          ref={triggerRef}
          id={id}
          className="app-select-trigger"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          <BaseSelect.Value className="app-select-value" />
          <BaseSelect.Icon className="app-select-arrow">
            <Icon name="expand_more" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal container={portalContainer}>
        <BaseSelect.Positioner
          className="app-select-positioner"
          positionMethod="fixed"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="app-select-menu">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className={({ selected, disabled: itemDisabled }) =>
                    `app-select-option ${selected ? "selected" : ""} ${itemDisabled ? "disabled" : ""}`.trim()
                  }
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
