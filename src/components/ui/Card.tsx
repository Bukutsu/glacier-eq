import type { ComponentProps } from "react";

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={`rounded-[var(--radius-card)] border border-border bg-[var(--card)] text-foreground ${className}`}
      {...props}
    />
  );
}
