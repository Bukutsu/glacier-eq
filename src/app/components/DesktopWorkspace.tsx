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
          className="desktop-brand leg:roomy:flex leg:roomy:items-center leg:roomy:min-h-[44px] leg:roomy:p-[0_var(--space-3)] leg:roomy:rounded-[var(--control-radius)] leg:roomy:gap-[var(--space-2)] leg:roomy:text-[color:var(--foreground)] leg:roomy:no-underline leg:roomy:text-[length:14px] leg:roomy:font-semibold leg:roomy:tracking-[-0.01em] leg:roomy:[&:hover]:opacity-85 leg:roomy:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:roomy:[&:focus-visible]:[outline-offset:2px]"
          to={workspacePath("eq")}
          aria-label={t("workspace.home")}
        >
          <svg
            className="leg:roomy:w-[22px] leg:roomy:h-[14px] leg:roomy:shrink-0 leg:roomy:text-[color:var(--blue)]"
            viewBox="100 290 824 480"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              transform="translate(0 1024) scale(.1 -.1)"
              d="M4119 7052c-166-44-297-190-424-472-26-58-114-306-196-552-152-458-214-613-299-739-109-160-239-239-445-270-38-6-252-14-475-17l-405-7-55-30c-72-39-113-100-135-199-14-63-15-84-5-133 22-106 75-183 155-226 39-22 48-22 490-22 427 0 456 1 561 23 139 28 194 47 319 110 255 127 423 328 587 702 69 155 99 241 232 650 108 330 172 501 192 507 12 4 58-91 103-215 17-45 90-270 162-500 224-716 361-1066 610-1564 351-702 588-939 917-915 227 16 412 173 654 555 290 456 374 534 643 597 122 28 249 37 650 44 392 6 412 8 450 28 80 42 133 120 155 226 25 122-35 271-134 332l-49 30-381 3c-412 4-555-4-751-43-152-29-220-52-355-120-234-117-365-256-615-650-172-271-259-375-312-375-43 0-177 173-290 375-275 492-473 992-758 1920-96 311-205 571-301 716-83 125-200 212-322 238-69 14-93 13-173-7z"
            />
          </svg>
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
            className="left-pane leg:min-w-[0] leg:min-h-[0] leg:flex leg:flex-col leg:gap-[var(--space-4)] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:pr-[var(--space-2)] leg:col-[1] leg:row-[2] leg:max-[960px]:[.mobile-workspace_&]:gap-[10px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1_0_auto] leg:compact:[.mobile-workspace_&&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:[.mobile-workspace_&&]:gap-[12px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:pr-[16px]! leg:compact:gap-[10px] leg:roomy:[.desktop-view-device_&]:hidden leg:roomy:[.desktop-view-settings_&&]:hidden"
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
