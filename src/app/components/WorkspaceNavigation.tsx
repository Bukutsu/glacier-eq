import { Fragment, type MouseEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { MOBILE_TABS, workspacePath, type MobileTab } from "@/lib/tabs";
import { mobileBarTab } from "@/app/hooks/useWorkspaceNavigation";

export function WorkspaceNavigation({
  mobile,
  activeTab,
  onSelect,
}: {
  mobile: boolean;
  activeTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}) {
  const { t } = useTranslation("shell");
  const tabs = mobile
    ? MOBILE_TABS.filter(({ id }) => id !== "device")
    : MOBILE_TABS;
  const current = mobile ? mobileBarTab(activeTab) : activeTab;
  function select(event: MouseEvent<HTMLAnchorElement>, id: MobileTab) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onSelect(id);
  }
  return (
    <nav
      className={mobile ? "mobile-tab-bar" : "desktop-sidebar-nav"}
      aria-label={t("navigation.primary")}
    >
      {tabs.map(({ id, icon, label }) => (
        <Fragment key={id}>
          {!mobile && id === "device" && (
            <div
              className="desktop-sidebar-divider"
              role="separator"
              aria-orientation="horizontal"
            />
          )}
          <Link
            to={workspacePath(id)}
            className={`${mobile ? "mobile-tab-item" : "desktop-sidebar-item"}${current === id ? " active" : ""}`}
            aria-current={current === id ? "page" : undefined}
            onClick={(event) => select(event, id)}
          >
            {mobile ? (
              <div className="mobile-tab-icon-wrapper">
                <Icon name={icon} />
              </div>
            ) : (
              <Icon name={icon} />
            )}
            <span>{label}</span>
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
