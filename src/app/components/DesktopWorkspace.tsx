import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { workspacePath, type MobileTab } from "@/lib/tabs";
import { WorkspaceNavigation } from "./WorkspaceNavigation";

export function DesktopWorkspace({
  activeTab,
  header,
  device,
  graph,
  editor,
  panels,
  onSelectTab,
}: {
  activeTab: MobileTab;
  header: ReactNode;
  device: ReactNode;
  graph: ReactNode;
  editor: ReactNode;
  panels: ReactNode;
  onSelectTab: (tab: MobileTab) => void;
}) {
  const { t } = useTranslation("shell");
  return (
    <main
      className={`workspace desktop-workspace desktop-view-${activeTab}`}
      aria-label={t("workspace.label")}
    >
      <aside className="desktop-sidebar leg:roomy:flex leg:roomy:min-w-[0] leg:roomy:min-h-[0] leg:roomy:flex-col leg:roomy:gap-[var(--space-4)] leg:roomy:p-[var(--space-4)_var(--space-3)] leg:roomy:[border-right:1px_solid_var(--line-soft)] leg:roomy:[background:var(--panel)] leg:roomy:overflow-y-auto leg:roomy:col-[1] leg:roomy:row-[1] cmp:[--foreground:var(--sidebar-foreground)] cmp:[--text:var(--sidebar-foreground)] cmp:[--muted:var(--sidebar-muted-foreground)] cmp:[--comment:var(--sidebar-muted-foreground)] cmp:[background:var(--sidebar)] cmp:text-[color:var(--sidebar-foreground)] cmp:[border-color:var(--sidebar-border)]">
        <Link
          className="desktop-brand leg:roomy:flex leg:roomy:items-center leg:roomy:min-h-[44px] leg:roomy:p-[0_var(--space-3)] leg:roomy:rounded-[var(--control-radius)] leg:roomy:text-[color:var(--muted-foreground)] leg:roomy:no-underline leg:roomy:text-[length:var(--type-label)] leg:roomy:font-medium leg:roomy:tracking-[-0.01em] leg:roomy:[&:hover]:text-[color:var(--foreground)] leg:roomy:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:roomy:[&:focus-visible]:[outline-offset:2px]"
          to={workspacePath("eq")}
          aria-label={t("workspace.home")}
        >
          <span>Glacier EQ</span>
        </Link>
        <WorkspaceNavigation
          mobile={false}
          activeTab={activeTab}
          onSelect={onSelectTab}
        />
        {device}
      </aside>
      <div className="desktop-content leg:roomy:grid leg:roomy:min-w-[0] leg:roomy:min-h-[0] leg:roomy:grid-cols-[minmax(0,_1fr)] leg:roomy:[grid-template-rows:auto_minmax(0,_1fr)] leg:roomy:gap-[var(--space-5)] leg:roomy:p-[var(--space-5)] leg:roomy:overflow-hidden leg:roomy:[.desktop-view-tuning_&]:gap-x-[var(--space-4)] leg:roomy:[.desktop-view-tuning_&]:grid-cols-[minmax(0,_1fr)_minmax(300px,_340px)] cmp:roomy:[.desktop-view-profiles_&]:grid-cols-[minmax(0,_1fr)]">
        {header}
        {activeTab !== "profiles" && (
          <section
            id={activeTab === "eq" ? "workspace-content" : "main-scroll-pane"}
            tabIndex={-1}
            aria-label={t("workspace.editor")}
            className="left-pane leg:min-w-[0] leg:min-h-[0] leg:flex leg:flex-col leg:gap-[var(--space-4)] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:pr-[var(--space-2)] leg:col-[1] leg:row-[2] leg:max-[960px]:[.mobile-workspace_&]:gap-[10px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1] leg:compact:[.mobile-workspace_&&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:[.mobile-workspace_&&]:gap-[12px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:pr-[16px]! leg:compact:gap-[10px] leg:roomy:[.desktop-view-device_&]:hidden leg:roomy:[.desktop-view-settings_&&]:hidden"
          >
            {graph}
            {activeTab === "eq" && editor}
          </section>
        )}
        {panels}
      </div>
    </main>
  );
}
