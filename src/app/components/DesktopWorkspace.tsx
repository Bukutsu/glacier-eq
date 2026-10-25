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
      <aside className="desktop-sidebar">
        <Link
          className="desktop-brand"
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
      <div className="desktop-content">
        {header}
        {activeTab !== "profiles" && (
          <section
            id={activeTab === "eq" ? "workspace-content" : "main-scroll-pane"}
            tabIndex={-1}
            aria-label={t("workspace.editor")}
            className="left-pane"
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
