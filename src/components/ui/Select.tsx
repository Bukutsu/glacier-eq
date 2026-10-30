// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { CSSProperties } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Icon } from "./Icon";
import { useDialogPortal } from "./dialogPortal";

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
  const { container: portalContainer, anchor: triggerRef } =
    useDialogPortal();
  // Like a native single select, show the first enabled option when the
  // controlled value isn't present (for example, while targets are loading).
  const selectedValue = options.some((option) => option.value === value)
    ? value
    : (options.find((option) => !option.disabled)?.value ?? null);

  return (
    <BaseSelect.Root<T>
      id={id}
      name={id}
      autoComplete="off"
      value={selectedValue}
      items={options}
      disabled={disabled}
      onValueChange={(nextValue) => {
        // Compare with the caller's value, not the displayed fallback: picking
        // the fallback option must still report it.
        if (disabled || nextValue === null || nextValue === value) return;
        const option = options.find((item) => item.value === nextValue);
        if (!option || option.disabled) return;
        onChange(nextValue);
      }}
    >
      <div
        className={`leg:relative leg:w-[100%] cmp:relative cmp:w-[100%] cmp:min-w-[0] ${disabled ? "disabled" : ""} ${className}`.trim()}
        style={style}
      >
        <BaseSelect.Trigger
          ref={triggerRef}
          id={id}
          className="app-select-trigger leg:[.mobile-filter-card_&]:h-[32px] leg:flex leg:items-center leg:justify-between leg:w-[100%] leg:h-[36px] leg:[background:var(--input-bg,_var(--surface-soft))] leg:text-[color:var(--text)] leg:p-[0_10px] leg:[border:1px_solid_var(--input-border,_var(--line))] leg:rounded-[var(--radius-control)] leg:[font-family:inherit] leg:text-[length:var(--type-label)] leg:cursor-pointer leg:text-left leg:[outline:none] leg:[transition:border-color_var(--motion-duration)_var(--motion-ease),_background-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] leg:[&:hover:not(:disabled)]:[background:var(--hover-bg)] leg:[&:focus-visible]:[outline:1px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:-1px] leg:[&:disabled]:opacity-[0.5] leg:[&:disabled]:cursor-not-allowed leg:[.add-trace-owner_&]:w-[100%] leg:compact:[.mobile-filter-card_&]:min-h-[44px] cmp:flex cmp:items-center cmp:justify-between cmp:gap-[var(--space-2)] cmp:min-w-[0] cmp:w-[100%] cmp:h-[var(--control-height)] cmp:p-[0_var(--space-3)] cmp:[border:1px_solid_var(--input-border)] cmp:rounded-[var(--control-radius)] cmp:[background:var(--input-bg)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:text-left cmp:cursor-pointer cmp:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:2px] cmp:[&:disabled]:opacity-[0.45] cmp:[&:disabled]:cursor-not-allowed cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&:active:not(:disabled)]:[background:var(--accent)] cmp:compact:[&:active:not(:disabled)]:text-[color:var(--accent-foreground)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:min-h-[44px] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:w-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:h-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:pr-[36px]"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          <BaseSelect.Value className="cmp:min-w-[0] cmp:overflow-hidden cmp:whitespace-nowrap cmp:text-ellipsis" />
          <BaseSelect.Icon className="app-select-arrow leg:absolute leg:top-[50%] leg:right-[10px] leg:[transform:translateY(-50%)] leg:inline-flex leg:items-center leg:justify-center leg:pointer-events-none leg:w-[20px] leg:h-[20px] leg:text-[length:18px] leg:text-[color:var(--muted)] cmp:static cmp:[transform:none] cmp:inline-flex cmp:flex-[0_0_auto] cmp:items-center cmp:justify-center cmp:w-[auto] cmp:h-[auto] cmp:text-[color:var(--muted)]">
            <Icon name="expand_more" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal container={portalContainer}>
        <BaseSelect.Positioner
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
          positionMethod="fixed"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="cmp:box-border cmp:max-h-[var(--available-height)] cmp:overflow-y-auto cmp:p-[var(--space-1)] cmp:[border:1px_solid_var(--line-medium)] cmp:rounded-[var(--radius-card)] cmp:[background:var(--popover)] cmp:text-[color:var(--popover-foreground)] cmp:[box-shadow:var(--shadow-md)] cmp:[outline:none] cmp:min-w-[var(--anchor-width)] cmp:max-w-[var(--available-width)]">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className={({ selected, disabled: itemDisabled }) =>
                    `cmp:flex cmp:min-h-[34px] cmp:items-center cmp:gap-[var(--space-2)] cmp:p-[var(--space-2)_var(--space-3)] cmp:rounded-[var(--control-radius)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:cursor-default cmp:[outline:none] cmp:[&[data-highlighted]]:[background:var(--accent)] cmp:[&[data-disabled]]:text-[color:var(--muted)] cmp:[&[data-disabled]]:opacity-[0.5] cmp:[&.selected]:font-semibold cmp:[&&.selected]:[background:var(--accent)] cmp:[.search-select-menu_&&.selected]:[background:transparent] cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] ${selected ? "selected" : ""} ${itemDisabled ? "disabled" : ""}`.trim()
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
