import type { ComponentProps } from "react";

export function Badge({ className = "", ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={`inline-flex shrink-0 items-center rounded-control border border-input bg-transparent px-2 py-0.5 font-sans text-xs font-medium leading-5 text-muted-foreground ${className}`}
      {...props}
    />
  );
}
