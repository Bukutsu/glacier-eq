// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useRef, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./Button";
import { Icon } from "./Icon";

export function OverflowMenu({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        aria-label={label}
        title={label}
        render={<Button variant="ghost" size="icon" />}
      >
        <Icon name="more_vert" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          positionMethod="fixed"
          className="ui-popup-positioner"
        >
          <Menu.Popup
            className={`ui-menu ${className}`.trim()}
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
