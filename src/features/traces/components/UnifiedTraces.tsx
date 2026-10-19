import { useTranslation } from "react-i18next";
import { memo } from "react";
import type { MeasurementTrace, TargetTrace } from "@/types";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { traceSwatchColor } from "@/features/traces/lib/traceColor";

interface UnifiedTracesListProps {
  measurements: MeasurementTrace[];
  allTargets: TargetTrace[];
  activeTargetIds: string[];
  onToggleMeasurement: (id: string) => void;
  onRemoveMeasurement: (id: string) => void;
  onToggleTarget: (id: string) => void;
  onRemoveTarget: (id: string) => void;
}

export const UnifiedTracesList = memo(function UnifiedTracesList({
  measurements,
  allTargets,
  activeTargetIds,
  onToggleMeasurement,
  onRemoveMeasurement,
  onToggleTarget,
  onRemoveTarget,
}: UnifiedTracesListProps) {
  const { t } = useTranslation("library");
  const isEmpty = measurements.length === 0 && allTargets.length === 0;

  return (
    <div className="trace-list">
      {isEmpty && <div className="curve-empty">{t("unifiedTraces.empty")}</div>}
      {measurements.map((trace) => (
        <div className="curve-item" key={trace.id}>
          <label className="curve-toggle">
            <input
              type="checkbox"
              className="custom-checkbox"
              checked={trace.visible}
              aria-label={t("unifiedTraces.measurementLabel", {
                name: trace.name,
                count: trace.points.length,
              })}
              onChange={() => onToggleMeasurement(trace.id)}
            />
            <span
              className="curve-swatch"
              style={{ backgroundColor: traceSwatchColor(trace.color) }}
            />
            <span
              className="curve-name"
              title={t("unifiedTraces.pointTitle", {
                name: trace.name,
                count: trace.points.length,
              })}
            >
              <span className="curve-label">{trace.name}</span>
              <span className="curve-points">
                {t("unifiedTraces.points", { count: trace.points.length })}
              </span>
            </span>
          </label>
          <span
            className="trace-type-badge trace-type-measure"
            aria-hidden="true"
            title={t("unifiedTraces.measurement")}
          >
            {t("unifiedTraces.measurementBadge")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="curve-delete"
            title={t("unifiedTraces.delete", { name: trace.name })}
            aria-label={t("unifiedTraces.delete", { name: trace.name })}
            onClick={() => onRemoveMeasurement(trace.id)}
          >
            <Icon name="delete" />
          </Button>
        </div>
      ))}
      {allTargets.map((target) => {
        const active = activeTargetIds.includes(target.id);
        return (
          <div className="curve-item" key={target.id}>
            <label className="curve-toggle">
              <input
                type="checkbox"
                className="custom-checkbox"
                checked={active}
                aria-label={t("unifiedTraces.target", { name: target.name })}
                onChange={() => onToggleTarget(target.id)}
              />
              <span
                className="curve-swatch"
                style={{ backgroundColor: traceSwatchColor(target.color) }}
              />
              <span className="curve-name" title={target.name}>
                <span className="curve-label">{target.name}</span>
              </span>
            </label>
            <span
              className="trace-type-badge trace-type-target"
              aria-hidden="true"
              title={t("unifiedTraces.targetTooltip")}
            >
              {t("unifiedTraces.targetBadge")}
            </span>
            {!target.builtIn ? (
              <Button
                variant="ghost"
                size="icon"
                className="curve-delete"
                title={t("unifiedTraces.delete", { name: target.name })}
                aria-label={t("unifiedTraces.delete", { name: target.name })}
                onClick={() => onRemoveTarget(target.id)}
              >
                <Icon name="delete" />
              </Button>
            ) : (
              <span className="curve-delete-spacer" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
});
