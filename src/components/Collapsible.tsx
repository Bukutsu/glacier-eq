import { type ReactNode, useId, useState } from "react";
import { Icon, type IconName } from "./Icon";

export function Collapsible({
  title,
  icon,
  children,
  defaultOpen = true,
  compact = false,
  className = "",
}: {
  title: ReactNode;
  icon?: IconName;
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
        {icon && <Icon name={icon} />}
        <span className="app-collapse-title">{title}</span>
        <Icon name={open ? "expand_less" : "expand_more"} />
      </button>
      <div id={contentId} className="app-collapse-content" hidden={!open}>
        <div className="app-collapse-content-inner">{children}</div>
      </div>
    </section>
  );
}
