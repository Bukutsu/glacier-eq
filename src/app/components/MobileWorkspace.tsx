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
        className={`workspace mobile-workspace leg:[scrollbar-width:none]! leg:[-ms-overflow-style:none]! cmp:compact:[.keyboard-open_&]:[scroll-padding-bottom:var(--space-4)] cmp:compact:[scroll-padding-bottom:calc(var(--tabbar-h)_+_var(--safe-area-bottom,_0px)_+_var(--space-4))] ${saveBar ? " has-save-bar" : ""}`}
        aria-label={title}
      >
        {activeTab !== "eq" && <h1 className="leg:absolute leg:w-[1px] leg:h-[1px] leg:p-[0] leg:m-[-1px] leg:overflow-hidden leg:[clip-path:inset(50%)] leg:whitespace-nowrap leg:[border:0]">{title}</h1>}
        {recovery}
        {graph}
        <div className="leg:compact:flex leg:compact:flex-col leg:compact:w-[100%] leg:compact:max-w-[100%] leg:compact:overflow-visible leg:compact:gap-[12px]">
          {activeTab === "eq" && (
            <section className="left-pane leg:min-w-[0] leg:min-h-[0] leg:flex leg:flex-col leg:gap-[var(--space-4)] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:pr-[var(--space-2)] leg:col-[1] leg:row-[2] leg:max-[960px]:[.mobile-workspace_&]:gap-[10px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1] leg:compact:[.mobile-workspace_&&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:[.mobile-workspace_&&]:gap-[12px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:pr-[16px]! leg:compact:gap-[10px] leg:roomy:[.desktop-view-device_&]:hidden leg:roomy:[.desktop-view-settings_&&]:hidden">{editor}</section>
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
