import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "./Icon";

type ConfigurationSection = { id: string; label: string; icon: IconName };

export function ConfigurationLayout({
  kind, active, sections, children,
}: {
  kind: "settings" | "device";
  active: string;
  sections: readonly ConfigurationSection[];
  children: ReactNode;
}) {
  return (
    <div className={`configuration-layout ${kind}-stack-view`}>
      <nav className={`configuration-navigation ${kind}-navigation`}
        aria-label={kind === "device" ? "Device settings" : "Settings"}>
        {sections.map(section => (
          <Link key={section.id} to={`/${kind}/${section.id}`}
            className="configuration-nav-link" aria-current={active === section.id ? "page" : undefined}>
            <Icon name={section.icon} />
            <span>{section.label}</span>
          </Link>
        ))}
      </nav>
      <div className="configuration-content">{children}</div>
    </div>
  );
}
