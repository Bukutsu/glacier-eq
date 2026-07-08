import type { InputHTMLAttributes } from "react";

interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {}

export function SearchBar({ className = "", ...props }: SearchBarProps) {
  return (
    <input
      type="text"
      className={`curves-search-input ${className}`.trim()}
      {...props}
    />
  );
}
