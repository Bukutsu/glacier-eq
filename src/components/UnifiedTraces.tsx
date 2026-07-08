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

export function UnifiedTracesList({
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
              checked={trace.visible}
              onChange={() => onToggleMeasurement(trace.id)}
            />
            <span className="curve-swatch" style={{ backgroundColor: trace.color }} />
            <span className="curve-name">
              {trace.name}
              <span className="curve-points">({trace.points.length} pts)</span>
            </span>
          </label>
          <span className="trace-type-badge trace-type-measure">M</span>
          <button
            className="curve-delete"
            title={`Delete ${trace.name}`}
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
                checked={active}
                onChange={() => onToggleTarget(target.id)}
              />
              <span className="curve-swatch" style={{ backgroundColor: target.color }} />
              <span className="curve-name">{target.name}</span>
            </label>
            <span className="trace-type-badge trace-type-target">T</span>
            {!target.builtIn && (
              <button
                className="curve-delete"
                title={`Delete ${target.name}`}
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
}
