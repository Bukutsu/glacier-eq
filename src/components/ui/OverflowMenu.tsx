// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useRef, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { useDialogPortal } from "./dialogPortal";

export function OverflowMenu({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { container, anchor } = useDialogPortal();
  const setTrigger = useCallback(
    (trigger: HTMLButtonElement | null) => {
      triggerRef.current = trigger;
      anchor(trigger);
    },
    [anchor],
  );
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={setTrigger}
        aria-label={label}
        title={label}
        render={<Button variant="ghost" size="icon" />}
      >
        <Icon name="more_vert" />
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          positionMethod="fixed"
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
        >
          <Menu.Popup
            className={`cmp:box-border cmp:max-h-[var(--available-height)] cmp:overflow-y-auto cmp:p-[var(--space-1)] cmp:[border:1px_solid_var(--line-medium)] cmp:rounded-[var(--radius-card)] cmp:[background:var(--popover)] cmp:text-[color:var(--popover-foreground)] cmp:[outline:none] cmp:min-w-[200px] cmp:[&&]:[border-color:var(--border)] cmp:[box-shadow:var(--shadow-sm)] ${className}`.trim()}
            aria-label={label}
            onClick={(event) => {
              // Native dialogs must remember the trigger, not an unmounted menu item.
              if (
                event.target instanceof Element &&
                event.target.closest('[role="menuitem"]')
              ) {
                triggerRef.current?.focus();
              }
            }}
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
