// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

/** Shadcn-style tooltip: wraps one focusable control and names it on hover
 *  and keyboard focus. The control still needs its own aria-label. */
export function Tooltip({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger delay={400} render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={6}
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
        >
          <TooltipPrimitive.Popup
            data-slot="tooltip-content"
            className="max-w-64 rounded-control border border-border bg-[var(--popover)] px-2 py-1 font-sans text-xs leading-5 text-foreground shadow-[var(--shadow-sm)]"
          >
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
