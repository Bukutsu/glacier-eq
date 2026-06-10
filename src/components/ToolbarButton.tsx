interface ToolbarButtonProps {
  children: string;
  primary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function ToolbarButton({ children, primary, onClick, disabled }: ToolbarButtonProps) {
  return (
    <button className={primary ? "btn filled" : "btn tonal"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
