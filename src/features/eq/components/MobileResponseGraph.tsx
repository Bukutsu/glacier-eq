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
            className="graph-card"
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
          <div className="graph-toolbar">
            {((showLegendToggle && !graphCollapsed) || compare) && (
              <div className="graph-toolbar-actions">
                {showLegendToggle && !graphCollapsed && (
                  <button
                    type="button"
                    className={`graph-legend-btn${legendOpen ? " active" : ""}`}
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
              className="graph-collapse-btn"
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
            className="graph-card"
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
