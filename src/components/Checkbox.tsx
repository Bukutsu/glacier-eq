import type { InputHTMLAttributes } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {}

export function Checkbox({ className = "", ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={`custom-checkbox ${className}`.trim()}
      {...props}
    />
  );
}
