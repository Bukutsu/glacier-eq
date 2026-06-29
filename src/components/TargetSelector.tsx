import { useRef } from "react";
import { readFileText } from "../lib/files";
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
      const points = parseMeasurementText(await readFileText(file));
      const name = file.name.replace(/\.[^/.]+$/, "");
      onAddTarget(name, points);
      setStatus(`Loaded target: ${name} (${points.length} points)`);
    } catch (error) {
      setStatus(`Target import failed: ${error}`);
    }
    event.target.value = "";
  };

  return (
    <section className="target-strip" aria-label="Target reference overlays">
      <div className="target-strip-head">
        <span>Targets</span>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          accept=".txt,.csv,text/plain,text/csv"
          onChange={handleFileChange}
        />
        <button className="target-add" onClick={() => fileInputRef.current?.click()}>
          <Icon>add</Icon>
          <span>Add Target</span>
        </button>
      </div>
      <div className="target-scroll">
        {targets.map((target) => {
          const active = activeTargetIds.includes(target.id);
          return (
            <button
              key={target.id}
              className={`target-chip ${active ? "active" : ""}`}
              onClick={() => onToggleTarget(target.id)}
              title={target.name}
            >
              <span className="target-chip-swatch" style={{ backgroundColor: target.color }} />
              <span className="target-chip-name">{target.name}</span>
              {!target.builtIn && (
                <span
                  className="target-chip-delete"
                  role="button"
                  tabIndex={0}
                  title={`Delete ${target.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveTarget(target.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveTarget(target.id);
                    }
                  }}
                >
                  <Icon>close</Icon>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
