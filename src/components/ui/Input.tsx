import type { ComponentProps } from "react";

export function Input({ className = "", type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={[
        "h-11 w-full min-w-0 rounded-control border border-input bg-field px-3",
        "font-sans text-[13px] pointer-coarse:text-base text-foreground placeholder:text-placeholder",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
