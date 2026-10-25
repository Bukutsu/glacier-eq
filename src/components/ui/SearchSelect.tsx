// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useRef } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Icon } from "./Icon";
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
  const portalContainer = useRef<HTMLElement | null>(null);
  // Native dialogs live in the top layer, above document.body portals.
  const triggerRef = useCallback((trigger: HTMLButtonElement | null) => {
    portalContainer.current = trigger
      ? (trigger.closest("dialog") ?? trigger.ownerDocument.body)
      : null;
  }, []);
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
        if (option && !option.disabled && option.value !== selected?.value)
          onChange(option.value);
      }}
    >
      <Combobox.Trigger id={id} className="app-select-trigger" ref={triggerRef}>
        <span className="app-select-value">
          <Combobox.Value />
        </span>
        <span className="app-select-arrow">
          <Icon name="expand_more" />
        </span>
      </Combobox.Trigger>
      <Combobox.Portal container={portalContainer}>
        <Combobox.Positioner
          className="app-select-positioner"
          positionMethod="fixed"
          align="start"
          sideOffset={4}
        >
          <Combobox.Popup className="app-select-menu search-select-menu">
            <Combobox.Input
              className="search-select-input"
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
            />
            <Combobox.Empty className="search-select-empty">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List className="search-select-list">
              {(option: SelectOption<string>) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  disabled={option.disabled}
                  className={({ selected: isSelected }) =>
                    isSelected
                      ? "app-select-option selected"
                      : "app-select-option"
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
