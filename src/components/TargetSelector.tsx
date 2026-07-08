import type { TargetTrace } from "../types";
import { Icon } from "./Icon";
import { Checkbox } from "./Checkbox";

interface TargetSelectorProps {
  targets: TargetTrace[];
  activeTargetIds: string[];
  onToggleTarget: (id: string) => void;
  onRemoveTarget: (id: string) => void;
}

export function TargetSelector({
  targets,
  activeTargetIds,
  onToggleTarget,
  onRemoveTarget,
}: TargetSelectorProps) {
  return (
    <div className="curve-list">
      {targets.map((target) => {
        const active = activeTargetIds.includes(target.id);
        return (
          <div className="curve-item" key={target.id}>
            <label className="curve-toggle">
              <Checkbox
                checked={active}
                onChange={() => onToggleTarget(target.id)}
              />
              <span className="curve-swatch" style={{ backgroundColor: target.color }} />
              <span className="curve-name">{target.name}</span>
            </label>
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
