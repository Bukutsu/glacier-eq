import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import type { MobileTab } from "@/lib/tabs";
import type { GraphPreview } from "../hooks/useGraphPreview";
import { graphHasLegend } from "./EqGraph";
import { WorkspaceGraph, type WorkspaceGraphProps } from "./WorkspaceGraph";

export function MobileResponseGraph({
  activeTab,
  visible,
  graph,
  preview,
  scrollRef: mobileScrollRef,
  curves: eqCurves,
  compare,
}: {
  activeTab: MobileTab;
  visible: boolean;
  graph: WorkspaceGraphProps;
  preview: GraphPreview;
  scrollRef: RefObject<HTMLElement | null>;
  curves: ReactNode;
  compare: ReactNode;
}) {
  const { t } = useTranslation("shell");
  const {
    graphCollapsed,
    setGraphCollapsed,
    showGraphPreview,
    handlePreviewClick,
  } = preview;
  const [legendOpen, setLegendOpen] = useState(false);
  const mobileGraphRef = useRef<HTMLElement | null>(null);
  const showLegendToggle = graphHasLegend(
    graph.peq,
    graph.committedPeq,
    graph.measurements,
    graph.targets,
  );
  // The band picker pins under the pinned graph, so it needs that height.
  useEffect(() => {
    const graph = mobileGraphRef.current;
    const workspace = mobileScrollRef.current;
    if (!graph || !workspace || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      /* eslint-disable i18next/no-literal-string -- CSS property, not UI text. */
      workspace.style.setProperty(
        "--mobile-graph-height",
        `${graph.offsetHeight}px`,
      );
      /* eslint-enable i18next/no-literal-string */
    });
    observer.observe(graph);
    return () => observer.disconnect();
  }, [activeTab, visible, graphCollapsed]);

  if (!visible) return null;
  return (
    <>
      {(activeTab === "eq" || activeTab === "tuning") && (
        <section
          ref={mobileGraphRef}
          className={`mobile-graph-container mobile-graph-${activeTab} ${graphCollapsed ? "collapsed" : ""}`}
        >
          <div
            className="graph-card leg:[background:var(--panel)] leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:flex-[1_1_auto] leg:min-h-[280px] leg:p-[var(--space-4)] leg:[border:1px_solid_var(--line-soft)] leg:flex leg:min-w-[0] leg:relative leg:[.left-pane>&]:sticky leg:[.left-pane>&]:top-[0] leg:[.left-pane>&]:z-[var(--z-graph-sticky)] leg:[.left-pane>&]:flex-col leg:compact:h-[clamp(230px,_34dvh,_300px)] leg:compact:min-h-[230px] leg:compact:p-[10px_8px_8px] leg:compact:rounded-[var(--radius-surface)]! leg:compact:[border:1px_solid_var(--line-soft)]! leg:compact:[background:var(--panel)]! leg:compact:overflow-hidden leg:compact:[.mobile-graph-container_&]:[transition:height_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:compact:[.mobile-graph-container_&]:opacity-[1] leg:compact:[.mobile-graph-container.collapsed_&]:h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:min-h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:[border:none]! leg:compact:[.mobile-graph-container.collapsed_&]:p-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:m-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:opacity-[0] leg:compact:[.mobile-graph-container.collapsed_&]:pointer-events-none leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&&]:h-[clamp(100px,_32dvh,_160px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&]:min-h-[100px] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&&]:h-[clamp(80px,_20dvh,_120px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&]:min-h-[80px] leg:compact:[.mobile-workspace_.mobile-graph-container>&]:rounded-[0]! leg:compact:[.mobile-workspace_.mobile-graph-container>&]:[border-inline:0]! leg:compact:[.mobile-graph-container_&&&&&]:h-[clamp(100px,_16dvh,_136px)] leg:compact:[.mobile-graph-container_&&&&]:min-h-[0] leg:compact:[.mobile-graph-container_&]:p-[6px_8px_4px] leg:compact:[.mobile-graph-tuning_&&&&&&]:h-[clamp(112px,_16dvh,_148px)] leg:compact:[.mobile-graph-tuning_&&&&&]:min-h-[0] leg:[@media(max-height:_580px)]:[.mobile-graph-container_&]:h-[clamp(80px,_18dvh,_100px)]! leg:[@media(max-height:_580px)]:[.mobile-graph-tuning_&&]:h-[clamp(65px,_15dvh,_90px)]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:min-h-[150px]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:h-[clamp(150px,_24dvh,_190px)]! leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-container_&&&&&&&]:h-[clamp(180px,_24dvh,_300px)] leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-tuning_&&&&&&&&]:h-[clamp(160px,_22dvh,_260px)] cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:h-[auto]! cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:max-h-[none]"
            inert={graphCollapsed ? true : undefined}
            aria-hidden={graphCollapsed}
          >
            <WorkspaceGraph
              {...graph}
              editing={activeTab === "eq"}
              focusBand={activeTab === "eq"}
              legendOpen={legendOpen}
            />
          </div>
          {/* Curves live under the plot so they never cover the data. */}
          <div className="graph-toolbar leg:flex leg:items-center leg:justify-end leg:gap-[var(--space-2)] leg:min-h-[32px] leg:m-[calc(-1_*_var(--space-2))_calc(-1_*_var(--space-2))_var(--space-1)] leg:compact:[.mobile-workspace_&]:justify-between leg:compact:[.mobile-workspace_&]:gap-[8px] leg:compact:[.mobile-workspace_&]:min-h-[0] leg:compact:[.mobile-workspace_&]:m-[0] leg:compact:[.mobile-workspace_&]:p-[0_4px]">
            {((showLegendToggle && !graphCollapsed) || compare) && (
              <div className="graph-toolbar-actions leg:flex leg:items-center leg:gap-[var(--space-1)] cmp:compact:[.mobile-workspace_.graph-toolbar>&]:order-[1] cmp:compact:[.mobile-workspace_.graph-toolbar>&]:ml-[auto]">
                {showLegendToggle && !graphCollapsed && (
                  <button
                    type="button"
                    className={`leg:inline-flex leg:items-center leg:justify-center leg:min-w-[32px] leg:min-h-[32px] leg:p-[0_var(--space-2)] leg:[border:1px_solid_transparent] leg:rounded-[var(--control-radius)] leg:[background:transparent] leg:text-[color:var(--muted-foreground)] leg:[font:inherit] leg:[&&]:text-[length:var(--type-small)] leg:[&&]:font-semibold leg:cursor-pointer leg:[&.active]:[background:var(--accent)] leg:[&.active]:text-[color:var(--foreground)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px] cmp:compact:[.mobile-workspace_&]:min-w-[var(--touch-md)] cmp:compact:[.mobile-workspace_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-workspace_&:active]:[background:var(--accent)] ${legendOpen ? " active" : ""}`}
                    aria-pressed={legendOpen}
                    aria-label={t("graph.legend")}
                    title={t("graph.legend")}
                    onClick={() => setLegendOpen((open) => !open)}
                  >
                    <Icon name="legend_toggle" />
                  </button>
                )}
                {compare}
              </div>
            )}
            <button
              type="button"
              className="graph-collapse-btn leg:compact:relative leg:compact:flex leg:compact:items-center leg:compact:justify-center leg:compact:w-[100%] leg:compact:min-h-[28px] leg:compact:h-[28px] leg:compact:[background:transparent] leg:compact:[border:0] leg:compact:text-[color:var(--muted)] leg:compact:cursor-pointer leg:compact:[transition:color_var(--motion-duration)_var(--motion-ease)] leg:compact:[&::before]:absolute leg:compact:[&::before]:inset-[12px_0] leg:compact:[&::before]:[background:var(--surface-soft)] leg:compact:[&::before]:[border:1px_solid_var(--line-soft)] leg:compact:[&&::before]:[border-top:none] leg:compact:[&&::before]:[border-bottom-left-radius:var(--radius-surface)] leg:compact:[&&::before]:[border-bottom-right-radius:var(--radius-surface)] leg:compact:[&::before]:[transition:background-color_var(--motion-duration)_var(--motion-ease)] leg:compact:[&:active]:text-[color:var(--link-foreground)] leg:compact:[&&:hover]:text-[color:var(--link-foreground)] leg:compact:[&:active::before]:[background:var(--surface)] leg:compact:[&&:hover::before]:[background:var(--surface)] leg:compact:[.mobile-workspace_.graph-toolbar>&]:order-[1] leg:compact:[.mobile-workspace_.graph-toolbar>&]:w-[auto] leg:compact:[.mobile-workspace_.graph-toolbar>&]:flex-[none] leg:compact:[.mobile-workspace_.graph-toolbar>&]:ml-[auto] leg:compact:[.mobile-workspace_.graph-toolbar>&]:px-[12px] leg:compact:[.mobile-workspace_.graph-toolbar>&&]:text-[color:var(--muted-foreground)] leg:compact:[.mobile-workspace_.graph-toolbar_&::before]:content-[none] leg:compact:gap-[var(--space-2)] leg:compact:text-[length:var(--type-small)] leg:compact:[&::before]:content-[none] cmp:compact:[.mobile-workspace_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-workspace_.graph-toolbar:has(>_.graph-toolbar-actions)>&]:order-[2] cmp:compact:[.mobile-workspace_.graph-toolbar:has(>_.graph-toolbar-actions)>&]:ml-[0]"
              onClick={() => setGraphCollapsed((value) => !value)}
              aria-expanded={!graphCollapsed}
              aria-label={
                graphCollapsed
                  ? t("graph.showResponse")
                  : t("graph.hideResponse")
              }
            >
              <span>{graphCollapsed ? t("graph.show") : t("graph.hide")}</span>
              <Icon name={graphCollapsed ? "expand_more" : "expand_less"} />
            </button>
            {eqCurves}
          </div>
        </section>
      )}
      {activeTab === "eq" && (
        <div
          className={`mobile-graph-preview ${showGraphPreview ? "visible" : ""}`}
          onClick={handlePreviewClick}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            handlePreviewClick();
          }}
          role="button"
          tabIndex={showGraphPreview ? 0 : -1}
          aria-label={t("graph.scroll")}
          aria-hidden={!showGraphPreview}
          inert={!showGraphPreview ? true : undefined}
        >
          <div
            className="graph-card leg:[background:var(--panel)] leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:flex-[1_1_auto] leg:min-h-[280px] leg:p-[var(--space-4)] leg:[border:1px_solid_var(--line-soft)] leg:flex leg:min-w-[0] leg:relative leg:[.left-pane>&]:sticky leg:[.left-pane>&]:top-[0] leg:[.left-pane>&]:z-[var(--z-graph-sticky)] leg:[.left-pane>&]:flex-col leg:compact:h-[clamp(230px,_34dvh,_300px)] leg:compact:min-h-[230px] leg:compact:p-[10px_8px_8px] leg:compact:rounded-[var(--radius-surface)]! leg:compact:[border:1px_solid_var(--line-soft)]! leg:compact:[background:var(--panel)]! leg:compact:overflow-hidden leg:compact:[.mobile-graph-container_&]:[transition:height_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:compact:[.mobile-graph-container_&]:opacity-[1] leg:compact:[.mobile-graph-container.collapsed_&]:h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:min-h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:[border:none]! leg:compact:[.mobile-graph-container.collapsed_&]:p-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:m-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:opacity-[0] leg:compact:[.mobile-graph-container.collapsed_&]:pointer-events-none leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&&]:h-[clamp(100px,_32dvh,_160px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&]:min-h-[100px] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&&]:h-[clamp(80px,_20dvh,_120px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&]:min-h-[80px] leg:compact:[.mobile-workspace_.mobile-graph-container>&]:rounded-[0]! leg:compact:[.mobile-workspace_.mobile-graph-container>&]:[border-inline:0]! leg:compact:[.mobile-graph-container_&&&&&]:h-[clamp(100px,_16dvh,_136px)] leg:compact:[.mobile-graph-container_&&&&]:min-h-[0] leg:compact:[.mobile-graph-container_&]:p-[6px_8px_4px] leg:compact:[.mobile-graph-tuning_&&&&&&]:h-[clamp(112px,_16dvh,_148px)] leg:compact:[.mobile-graph-tuning_&&&&&]:min-h-[0] leg:[@media(max-height:_580px)]:[.mobile-graph-container_&]:h-[clamp(80px,_18dvh,_100px)]! leg:[@media(max-height:_580px)]:[.mobile-graph-tuning_&&]:h-[clamp(65px,_15dvh,_90px)]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:min-h-[150px]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:h-[clamp(150px,_24dvh,_190px)]! leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-container_&&&&&&&]:h-[clamp(180px,_24dvh,_300px)] leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-tuning_&&&&&&&&]:h-[clamp(160px,_22dvh,_260px)] cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:h-[auto]! cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:max-h-[none]"
            style={{
              height: "100%",
              padding: 0,
              border: "none",
              background: "transparent",
            }}
          >
            <WorkspaceGraph {...graph} focusBand legendOpen={false} />
          </div>
        </div>
      )}
    </>
  );
}
