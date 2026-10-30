// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { Combobox } from "@base-ui/react/combobox";
import { Icon } from "./Icon";
import { useDialogPortal } from "./dialogPortal";
import type { SelectOption } from "./Select";

export interface SearchSelectProps {
  id?: string;
  value: string;
  options: SelectOption<string>[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Accessible name and placeholder for the search field. */
  searchLabel: string;
  searchPlaceholder: string;
  emptyText: string;
}

/** A Select with a search field, for lists too long to scan. */
export function SearchSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  searchLabel,
  searchPlaceholder,
  emptyText,
}: SearchSelectProps) {
  const { container: portalContainer, anchor: triggerRef } =
    useDialogPortal();
  const selected =
    options.find((option) => option.value === value) ??
    options.find((option) => !option.disabled) ??
    null;

  return (
    <Combobox.Root<SelectOption<string>>
      name={id}
      items={options}
      value={selected}
      disabled={disabled}
      filter={(option, search) =>
        option.label.toLowerCase().includes(search.trim().toLowerCase())
      }
      isItemEqualToValue={(a, b) => a.value === b.value}
      onValueChange={(option) => {
        // Compare with the caller's value, not the displayed fallback: picking
        // the fallback option must still report it.
        if (option && !option.disabled && option.value !== value)
          onChange(option.value);
      }}
    >
      <Combobox.Trigger id={id} className="app-select-trigger leg:[.mobile-filter-card_&]:h-[32px] leg:flex leg:items-center leg:justify-between leg:w-[100%] leg:h-[36px] leg:[background:var(--input-bg,_var(--surface-soft))] leg:text-[color:var(--text)] leg:p-[0_10px] leg:[border:1px_solid_var(--input-border,_var(--line))] leg:rounded-[var(--radius-control)] leg:[font-family:inherit] leg:text-[length:var(--type-label)] leg:cursor-pointer leg:text-left leg:[outline:none] leg:[transition:border-color_var(--motion-duration)_var(--motion-ease),_background-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] leg:[&:hover:not(:disabled)]:[background:var(--hover-bg)] leg:[&:focus-visible]:[outline:1px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:-1px] leg:[&:disabled]:opacity-[0.5] leg:[&:disabled]:cursor-not-allowed leg:[.add-trace-owner_&]:w-[100%] leg:compact:[.mobile-filter-card_&]:min-h-[44px] cmp:flex cmp:items-center cmp:justify-between cmp:gap-[var(--space-2)] cmp:min-w-[0] cmp:w-[100%] cmp:h-[var(--control-height)] cmp:p-[0_var(--space-3)] cmp:[border:1px_solid_var(--input-border)] cmp:rounded-[var(--control-radius)] cmp:[background:var(--input-bg)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:text-left cmp:cursor-pointer cmp:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:2px] cmp:[&:disabled]:opacity-[0.45] cmp:[&:disabled]:cursor-not-allowed cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&:active:not(:disabled)]:[background:var(--accent)] cmp:compact:[&:active:not(:disabled)]:text-[color:var(--accent-foreground)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:min-h-[44px] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:w-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:h-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:pr-[36px]" ref={triggerRef}>
        <span className="cmp:min-w-[0] cmp:overflow-hidden cmp:whitespace-nowrap cmp:text-ellipsis">
          <Combobox.Value />
        </span>
        <span className="app-select-arrow leg:absolute leg:top-[50%] leg:right-[10px] leg:[transform:translateY(-50%)] leg:inline-flex leg:items-center leg:justify-center leg:pointer-events-none leg:w-[20px] leg:h-[20px] leg:text-[length:18px] leg:text-[color:var(--muted)] cmp:static cmp:[transform:none] cmp:inline-flex cmp:flex-[0_0_auto] cmp:items-center cmp:justify-center cmp:w-[auto] cmp:h-[auto] cmp:text-[color:var(--muted)]">
          <Icon name="expand_more" />
        </span>
      </Combobox.Trigger>
      <Combobox.Portal container={portalContainer}>
        <Combobox.Positioner
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
          positionMethod="fixed"
          align="start"
          sideOffset={4}
        >
          <Combobox.Popup className="cmp:box-border cmp:max-h-[var(--available-height)] cmp:overflow-y-auto cmp:p-[var(--space-1)] cmp:[border:1px_solid_var(--line-medium)] cmp:rounded-[var(--radius-card)] cmp:[background:var(--popover)] cmp:text-[color:var(--popover-foreground)] cmp:[box-shadow:var(--shadow-md)] cmp:[outline:none] cmp:min-w-[var(--anchor-width)] cmp:max-w-[var(--available-width)] search-select-menu cmp:[&&]:flex cmp:[&&]:flex-col cmp:[&&]:w-[max(240px,_var(--anchor-width))] cmp:[&&&]:max-h-[min(320px,_var(--available-height))] cmp:[&&]:p-[0] cmp:[&&]:overflow-hidden">
            <Combobox.Input
              className="cmp:block cmp:flex-[0_0_auto] cmp:w-[100%] cmp:min-w-[0] cmp:h-[40px] cmp:box-border cmp:p-[0_var(--space-3)] cmp:[border:0] cmp:[&&]:[border-bottom:1px_solid_var(--line-medium)] cmp:rounded-[0] cmp:[background:var(--popover)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:-2px]"
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
            />
            <Combobox.Empty className="cmp:[&:not(:empty)]:flex-[0_0_auto] cmp:[&:not(:empty)]:p-[var(--space-3)] cmp:[&:not(:empty)]:text-[color:var(--muted)] cmp:[&:not(:empty)]:text-[length:var(--type-label)]">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List className="cmp:block cmp:flex-[1_1_auto] cmp:min-h-[0] cmp:overflow-y-auto cmp:[overscroll-behavior:contain] cmp:p-[var(--space-1)]">
              {(option: SelectOption<string>) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  disabled={option.disabled}
                  className={({ selected: isSelected }) =>
                    isSelected
                      ? "cmp:flex cmp:min-h-[34px] cmp:items-center cmp:gap-[var(--space-2)] cmp:p-[var(--space-2)_var(--space-3)] cmp:rounded-[var(--control-radius)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:cursor-default cmp:[outline:none] cmp:[&[data-highlighted]]:[background:var(--accent)] cmp:[&[data-disabled]]:text-[color:var(--muted)] cmp:[&[data-disabled]]:opacity-[0.5] cmp:[&.selected]:font-semibold cmp:[&&.selected]:[background:var(--accent)] cmp:[.search-select-menu_&&.selected]:[background:transparent] cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] selected"
                      : "cmp:flex cmp:min-h-[34px] cmp:items-center cmp:gap-[var(--space-2)] cmp:p-[var(--space-2)_var(--space-3)] cmp:rounded-[var(--control-radius)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:cursor-default cmp:[outline:none] cmp:[&[data-highlighted]]:[background:var(--accent)] cmp:[&[data-disabled]]:text-[color:var(--muted)] cmp:[&[data-disabled]]:opacity-[0.5] cmp:[&.selected]:font-semibold cmp:[&&.selected]:[background:var(--accent)] cmp:[.search-select-menu_&&.selected]:[background:transparent] cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation]"
                  }
                >
                  {option.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
