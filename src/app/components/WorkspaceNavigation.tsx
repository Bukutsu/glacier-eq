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
      className={mobile ? "leg:hidden leg:compact:flex leg:compact:fixed leg:compact:bottom-[0] leg:compact:left-[0] leg:compact:right-[0] leg:compact:h-[calc(var(--tabbar-h,_56px)_+_var(--safe-area-bottom,_0px))] leg:compact:items-center leg:compact:p-[2px_max(6px,_var(--safe-area-right,_0px))_var(--safe-area-bottom,_0px)_max(6px,_var(--safe-area-left,_0px))] leg:compact:[background:var(--bg)] leg:compact:[border-top:1px_solid_var(--line-medium)] leg:compact:z-[var(--z-tabbar)] leg:compact:[-webkit-tap-highlight-color:transparent]! leg:compact:select-none! leg:compact:[@media(orientation:_landscape)]:[&&]:h-[calc(56px_+_var(--safe-area-bottom,_0px))] leg:[@media(max-height:_580px)]:h-[calc(56px_+_var(--safe-area-bottom,_0px))]! cmp:compact:[.keyboard-open_&]:hidden" : "leg:roomy:flex leg:roomy:flex-col leg:roomy:gap-[var(--space-1)]"}
      aria-label={t("navigation.primary")}
    >
      {tabs.map(({ id, icon, label }) => (
        <Fragment key={id}>
          {!mobile && id === "device" && (
            <div
              className="leg:roomy:h-[1px] leg:roomy:m-[var(--space-3)_var(--space-2)] leg:roomy:[background:var(--line-soft)]"
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
              <div className="leg:compact:flex leg:compact:items-center leg:compact:justify-center leg:compact:text-[color:inherit] leg:compact:pointer-events-none leg:compact:[transition:none]! leg:compact:[.mobile-tab-item.active_&]:text-[color:var(--link-foreground)] cmp:compact:w-[48px] cmp:compact:h-[28px] cmp:compact:rounded-[var(--radius-pill)] cmp:compact:[.mobile-tab-item.active_&]:text-[color:var(--accent-foreground)] cmp:compact:[.mobile-tab-item.active_&]:[background:var(--accent)] cmp:compact:[.mobile-tab-item:active_&&]:[background:var(--accent)]">
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
