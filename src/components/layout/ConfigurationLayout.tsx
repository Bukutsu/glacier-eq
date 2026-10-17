import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useIsMobile } from "@/hooks/useIsMobile";

type ConfigurationSection = {
  id: string;
  label: string;
  icon: IconName;
  description?: string;
};

export function ConfigurationLayout({
  kind,
  active,
  root = false,
  sections,
  sectionValues,
  sectionTitle,
  summary,
  children,
}: {
  kind: "settings" | "device";
  active: string;
  root?: boolean;
  sections: readonly ConfigurationSection[];
  sectionValues?: Readonly<Record<string, string | undefined>>;
  sectionTitle?: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationRef = useRef<HTMLElement>(null);
  const previousSection = useRef<string | null>(null);
  const title = kind === "device" ? "Device" : "Settings";

  useEffect(() => {
    if (!mobile) return;
    if (!root) {
      previousSection.current = active;
      return;
    }
    const section = previousSection.current;
    if (section) {
      navigationRef.current
        ?.querySelector<HTMLElement>(`[data-section="${section}"]`)
        ?.focus();
      previousSection.current = null;
    }
  }, [mobile, root, active]);

  if (mobile) {
    const groups =
      kind === "settings"
        ? [sections.slice(0, 2), sections.slice(2)]
        : [sections];
    return (
      <div
        className={`configuration-layout configuration-mobile ${kind}-stack-view`}
      >
        {root ? (
          <>
            <h2 className="configuration-root-title">{title}</h2>
            {summary && <div className="configuration-content">{summary}</div>}
            <nav
              ref={navigationRef}
              className="configuration-list"
              aria-label={`${title} sections`}
            >
              {groups
                .filter((group) => group.length)
                .map((group, index) => (
                  <div className="configuration-list-group" key={index}>
                    {group.map((section) => (
                      <Link
                        key={section.id}
                        to={`/${kind}/${section.id}`}
                        state={{ configurationRoot: kind }}
                        data-section={section.id}
                        className="configuration-list-row"
                      >
                        <span className="configuration-list-icon">
                          <Icon name={section.icon} />
                        </span>
                        <span className="configuration-list-copy">
                          <span className="configuration-list-title">
                            {section.label}
                          </span>
                          {(sectionValues?.[section.id] ||
                            section.description) && (
                            <span className="configuration-list-description">
                              {sectionValues?.[section.id] ||
                                section.description}
                            </span>
                          )}
                        </span>
                        <Icon name="chevron_right" />
                      </Link>
                    ))}
                  </div>
                ))}
            </nav>
          </>
        ) : (
          <>
            <header className="configuration-subsection-header">
              <Button
                variant="ghost"
                className="configuration-back"
                onClick={() => {
                  if (location.state?.configurationRoot === kind) navigate(-1);
                  else navigate(`/${kind}`, { replace: true });
                }}
                aria-label={`Back to ${title.toLowerCase()}`}
              >
                <Icon name="arrow_back" />
              </Button>
              <h2>
                {sectionTitle ??
                  sections.find((section) => section.id === active)?.label ??
                  title}
              </h2>
            </header>
            <div className="configuration-content">{children}</div>
          </>
        )}
      </div>
    );
  }

  const single = sections.length <= 1;
  return (
    <div
      className={`configuration-layout ${kind}-stack-view${single ? " single" : ""}`}
    >
      {!single && (
        <nav
          className={`configuration-navigation ${kind}-navigation`}
          aria-label={kind === "device" ? "Device settings" : "Settings"}
        >
          {sections.map((section) => (
            <Link
              key={section.id}
              to={`/${kind}/${section.id}`}
              className="configuration-nav-link"
              aria-current={active === section.id ? "page" : undefined}
            >
              <Icon name={section.icon} />
              <span>{section.label}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="configuration-content">
        {summary}
        {children}
      </div>
    </div>
  );
}
