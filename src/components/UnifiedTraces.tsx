import { memo } from "react";
import type { MeasurementTrace, TargetTrace } from "../types";
import { Icon } from "./Icon";


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
  const isEmpty = measurements.length === 0 && allTargets.length === 0;

  return (
    <div className="trace-list">
      {isEmpty && (
        <div className="curve-empty">No traces loaded. Tap Add Trace to get started.</div>
      )}
      {measurements.map((trace) => (
        <div className="curve-item" key={trace.id}>
          <label className="curve-toggle">
            <input
              type="checkbox"
              className="custom-checkbox"
              checked={trace.visible}
              aria-label={`Measurement: ${trace.name} (${trace.points.length} points)`}
              onChange={() => onToggleMeasurement(trace.id)}
            />
            <span className="curve-swatch" style={{ backgroundColor: trace.color }} />
            <span className="curve-name">
              {trace.name}
              <span className="curve-points">({trace.points.length} pts)</span>
            </span>
          </label>
          <span className="trace-type-badge trace-type-measure" aria-hidden="true" title="Measurement">M</span>
          <button
            className="curve-delete"
            title={`Delete ${trace.name}`}
            aria-label={`Delete ${trace.name}`}
            onClick={() => onRemoveMeasurement(trace.id)}
          >
            <Icon>delete</Icon>
          </button>
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
                aria-label={`Target: ${target.name}`}
                onChange={() => onToggleTarget(target.id)}
              />
              <span className="curve-swatch" style={{ backgroundColor: target.color }} />
              <span className="curve-name">{target.name}</span>
            </label>
            <span className="trace-type-badge trace-type-target" aria-hidden="true" title="Target">T</span>
            {!target.builtIn && (
              <button
                className="curve-delete"
                title={`Delete ${target.name}`}
                aria-label={`Delete ${target.name}`}
                onClick={() => onRemoveTarget(target.id)}
              >
                <Icon>delete</Icon>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
