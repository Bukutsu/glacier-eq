import { Button as ButtonPrimitive } from "@base-ui/react/button";

type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  variant?: "default" | "primary" | "ghost";
  size?: "default" | "icon";
  className?: string;
};

const variants = {
  default: "border-border bg-control text-foreground hover:bg-control-hover",
  primary: "border-border bg-primary text-foreground hover:bg-primary-hover",
  ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-control hover:text-foreground",
};

export function Button({ variant = "default", size = "default", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      type={type}
      data-slot="button"
      data-variant={variant}
      className={[
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-sans text-[13px] font-medium leading-none",
        "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        size === "icon" ? "size-[34px] p-0 pointer-coarse:size-11" : "h-[34px] px-3 pointer-coarse:min-h-11",
        variants[variant],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
