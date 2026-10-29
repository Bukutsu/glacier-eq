import "@/lib/i18n";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("shell");
  const mobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationRef = useRef<HTMLElement>(null);
  const previousSection = useRef<string | null>(null);
  const title =
    kind === "device" ? t("navigation.device") : t("navigation.settings");

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
        className={`configuration-layout cmp:grid cmp:grid-cols-[184px_minmax(0,_1fr)] cmp:[align-items:start] cmp:gap-[var(--space-6)] cmp:w-[100%] cmp:max-w-[1000px] cmp:m-[0] cmp:min-w-[0] cmp:box-border cmp:[&.single]:grid-cols-[minmax(0,_1fr)] cmp:[&.single]:max-w-[816px] cmp:max-[1050px]:grid-cols-[152px_minmax(0,_1fr)] cmp:max-[1050px]:gap-[var(--space-5)] cmp:compact:[&&]:grid-cols-[minmax(0,_1fr)] cmp:compact:[&&]:gap-[var(--space-5)] cmp:compact:p-[var(--space-4)_max(var(--space-4),_var(--safe-area-right,_0px))_var(--space-5)_max(var(--space-4),_var(--safe-area-left,_0px))] configuration-mobile cmp:compact:[&&&]:gap-[var(--space-4)] ${kind}-stack-view`}
      >
        {root ? (
          <>
            <h2 className="cmp:compact:m-[var(--space-2)_0_var(--space-1)] cmp:compact:text-[length:24px] cmp:compact:font-semibold cmp:compact:leading-[1.3]">{title}</h2>
            {summary && <div className="cmp:min-w-[0]">{summary}</div>}
            <nav
              ref={navigationRef}
              className="cmp:compact:flex cmp:compact:flex-col cmp:compact:gap-[var(--space-4)] cmp:compact:min-w-[0]"
              aria-label={t(
                kind === "device"
                  ? "navigation.deviceSections"
                  : "navigation.settingsSections",
              )}
            >
              {groups
                .filter((group) => group.length)
                .map((group, index) => (
                  <div className="cmp:compact:overflow-hidden cmp:compact:[background:var(--card)] cmp:compact:[border:1px_solid_var(--border)] cmp:compact:rounded-[16px]" key={index}>
                    {group.map((section) => (
                      <Link
                        key={section.id}
                        to={`/${kind}/${section.id}`}
                        state={{ configurationRoot: kind }}
                        data-section={section.id}
                        className="configuration-list-row cmp:compact:relative cmp:compact:flex cmp:compact:items-center cmp:compact:gap-[var(--space-3)] cmp:compact:min-h-[80px] cmp:compact:p-[var(--space-4)] cmp:compact:box-border cmp:compact:text-[color:var(--foreground)] cmp:compact:no-underline cmp:compact:[-webkit-tap-highlight-color:transparent] cmp:compact:[.configuration-list-row+&::before]:content-[''] cmp:compact:[.configuration-list-row+&::before]:absolute cmp:compact:[.configuration-list-row+&::before]:top-[0] cmp:compact:[.configuration-list-row+&::before]:left-[64px] cmp:compact:[.configuration-list-row+&::before]:right-[var(--space-4)] cmp:compact:[.configuration-list-row+&::before]:[border-top:1px_solid_var(--border)] cmp:compact:[&:active]:[background:var(--accent)] cmp:compact:[@media(hover:_hover)]:[&&:hover]:[background:var(--accent)] cmp:compact:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:compact:[&:focus-visible]:[outline-offset:-3px]"
                      >
                        <span className="configuration-list-icon cmp:compact:grid cmp:compact:[place-items:center] cmp:compact:w-[32px] cmp:compact:h-[32px] cmp:compact:flex-[0_0_32px] cmp:compact:rounded-[50%] cmp:compact:[background:var(--accent)] cmp:compact:text-[color:var(--foreground)]">
                          <Icon name={section.icon} />
                        </span>
                        <span className="cmp:compact:flex cmp:compact:flex-[1] cmp:compact:min-w-[0] cmp:compact:flex-col cmp:compact:gap-[var(--space-1)]">
                          <span className="cmp:compact:text-[length:15px] cmp:compact:leading-[1.4] cmp:compact:font-medium">
                            {section.label}
                          </span>
                          {(sectionValues?.[section.id] ||
                            section.description) && (
                            <span className="cmp:compact:text-[color:var(--muted-foreground)] cmp:compact:text-[length:var(--type-small)] cmp:compact:leading-[1.4]">
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
            <header className="configuration-subsection-header cmp:compact:flex cmp:compact:items-center cmp:compact:gap-[var(--space-2)]">
              <Button
                variant="ghost"
                className="cmp:compact:[.configuration-mobile_&]:w-[48px] cmp:compact:[.configuration-mobile_&]:h-[48px] cmp:compact:[.configuration-mobile_&]:p-[0] cmp:compact:[.configuration-mobile_&]:shrink-0 cmp:compact:[.configuration-mobile_&]:ml-[calc(-1_*_var(--space-3))]"
                onClick={() => {
                  if (location.state?.configurationRoot === kind) navigate(-1);
                  else navigate(`/${kind}`, { replace: true });
                }}
                aria-label={t(
                  kind === "device"
                    ? "navigation.backToDevice"
                    : "navigation.backToSettings",
                )}
              >
                <Icon name="arrow_back" />
              </Button>
              <h2>
                {sectionTitle ??
                  sections.find((section) => section.id === active)?.label ??
                  title}
              </h2>
            </header>
            <div className="cmp:min-w-[0]">{children}</div>
          </>
        )}
      </div>
    );
  }

  const single = sections.length <= 1;
  return (
    <div
      className={`configuration-layout cmp:grid cmp:grid-cols-[184px_minmax(0,_1fr)] cmp:[align-items:start] cmp:gap-[var(--space-6)] cmp:w-[100%] cmp:max-w-[1000px] cmp:m-[0] cmp:min-w-[0] cmp:box-border cmp:[&.single]:grid-cols-[minmax(0,_1fr)] cmp:[&.single]:max-w-[816px] cmp:max-[1050px]:grid-cols-[152px_minmax(0,_1fr)] cmp:max-[1050px]:gap-[var(--space-5)] cmp:compact:[&&]:grid-cols-[minmax(0,_1fr)] cmp:compact:[&&]:gap-[var(--space-5)] cmp:compact:p-[var(--space-4)_max(var(--space-4),_var(--safe-area-right,_0px))_var(--space-5)_max(var(--space-4),_var(--safe-area-left,_0px))] ${kind}-stack-view${single ? " single" : ""}`}
    >
      {!single && (
        <nav
          className={`configuration-navigation ${kind}-navigation`}
          aria-label={
            kind === "device"
              ? t("navigation.deviceSettings")
              : t("navigation.settings")
          }
        >
          {sections.map((section) => (
            <Link
              key={section.id}
              to={`/${kind}/${section.id}`}
              className="configuration-nav-link cmp:flex cmp:items-center cmp:gap-[var(--space-2)] cmp:min-h-[38px] cmp:p-[var(--space-2)_var(--space-3)] cmp:box-border cmp:rounded-[var(--control-radius)] cmp:text-[color:var(--muted-foreground)] cmp:text-[length:var(--type-label)] cmp:no-underline cmp:[&:hover]:text-[color:var(--foreground)] cmp:[&:hover]:[background:var(--accent)] cmp:[&&[aria-current='page']]:text-[color:var(--accent-foreground)] cmp:[&&[aria-current='page']]:[background:var(--accent)] cmp:[&[aria-current='page']]:font-medium cmp:compact:min-h-[44px] cmp:compact:p-[var(--space-2)] cmp:compact:[&&&:active]:[background:var(--accent)] cmp:compact:[&&&:active]:text-[color:var(--accent-foreground)]"
              aria-current={active === section.id ? "page" : undefined}
            >
              <Icon name={section.icon} />
              <span>{section.label}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="cmp:min-w-[0]">
        {summary}
        {children}
      </div>
    </div>
  );
}
