import { Button as ButtonPrimitive } from "@base-ui/react/button";

type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "default" | "icon";
  className?: string;
};

const variants = {
  default: "border-input bg-control text-foreground hover:bg-control-hover",
  primary:
    "border-primary bg-primary text-primary-foreground hover:bg-primary-hover disabled:border-[var(--line-medium)] disabled:bg-[var(--surface-disabled)] disabled:text-[var(--text-disabled)] disabled:opacity-100",
  danger:
    "border-input bg-control text-destructive-foreground hover:bg-control-hover",
  ghost:
    "border-transparent bg-transparent text-[color-mix(in_srgb,var(--foreground)_78%,transparent)] hover:bg-accent hover:text-accent-foreground",
};

export function Button({
  variant = "default",
  size = "default",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      type={type}
      data-slot="button"
      data-variant={variant}
      className={[
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-sans text-[13px] font-medium leading-none",
        "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        size === "icon"
          ? "size-[var(--control-height)] p-0 pointer-coarse:size-11"
          : "h-[var(--control-height)] px-3 pointer-coarse:min-h-11",
        variants[variant],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
