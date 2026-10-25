import type { ReactNode, RefObject } from "react";
import type { MobileTab } from "@/lib/tabs";
import { WorkspaceNavigation } from "./WorkspaceNavigation";

export function MobileWorkspace({
  activeTab,
  title,
  header,
  scrollRef,
  recovery,
  graph,
  editor,
  panels,
  saveBar,
  onSelectTab,
}: {
  activeTab: MobileTab;
  title: string;
  header: ReactNode;
  scrollRef: RefObject<HTMLElement | null>;
  recovery: ReactNode;
  graph: ReactNode;
  editor: ReactNode;
  panels: ReactNode;
  saveBar: ReactNode;
  onSelectTab: (tab: MobileTab) => void;
}) {
  return (
    <>
      {header}
      <main
        id="workspace-content"
        tabIndex={-1}
        ref={scrollRef}
        className={`workspace mobile-workspace${saveBar ? " has-save-bar" : ""}`}
        aria-label={title}
      >
        {activeTab !== "eq" && <h1 className="visually-hidden">{title}</h1>}
        {recovery}
        {graph}
        <div className="mobile-content-area">
          {activeTab === "eq" && (
            <section className="left-pane">{editor}</section>
          )}
          {panels}
        </div>
        {saveBar}
        <WorkspaceNavigation
          mobile
          activeTab={activeTab}
          onSelect={onSelectTab}
        />
      </main>
    </>
  );
}
