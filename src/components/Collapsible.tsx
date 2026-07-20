import { type ReactNode, useId, useState } from "react";
import { Icon } from "./Icon";

export function Collapsible({
  title,
  icon,
  children,
  defaultOpen = true,
  compact = false,
  className = "",
}: {
  title: ReactNode;
  icon?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={`app-collapse${open ? " open" : ""}${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="app-collapse-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <Icon>{icon}</Icon>}
        <span className="app-collapse-title">{title}</span>
        <Icon>{open ? "expand_less" : "expand_more"}</Icon>
      </button>
      <div id={contentId} className="app-collapse-content" hidden={!open}>
        <div className="app-collapse-content-inner">{children}</div>
      </div>
    </section>
  );
}
