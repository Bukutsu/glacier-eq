import { useRef } from "react";
import { parseMeasurementText } from "../lib/measurements";
import type { TargetTrace } from "../types";
import { Icon } from "./Icon";

interface TargetSelectorProps {
  targets: TargetTrace[];
  activeTargetIds: string[];
  onToggleTarget: (id: string) => void;
  onAddTarget: (name: string, points: TargetTrace["points"]) => void;
  onRemoveTarget: (id: string) => void;
  setStatus: (value: string) => void;
}

export function TargetSelector({
  targets,
  activeTargetIds,
  onToggleTarget,
  onAddTarget,
  onRemoveTarget,
  setStatus,
}: TargetSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setStatus("Target import failed: choose a .csv or .txt file.");
      event.target.value = "";
      return;
    }

    try {
      const points = parseMeasurementText(await file.text());
      const name = file.name.replace(/\.[^/.]+$/, "");
      onAddTarget(name, points);
      setStatus(`Loaded target: ${name} (${points.length} points)`);
    } catch (error) {
      setStatus(`Target import failed: ${error}`);
    }
    event.target.value = "";
  };

  return (
    <div className="target-pane">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        accept=".txt,.csv,text/plain,text/csv"
        onChange={handleFileChange}
      />
      <div className="transfer-actions target-import-grid">
        <button className="icon-action" onClick={() => fileInputRef.current?.click()}>
          <Icon>playlist_add</Icon>
          <span>Add Target</span>
        </button>
      </div>
      <div className="curve-list" style={{ marginTop: "10px" }}>
        {targets.map((target) => {
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
    </div>
  );
}
