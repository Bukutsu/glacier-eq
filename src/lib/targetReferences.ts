import { parseMeasurementText } from "./measurements";
import type { TargetTrace } from "../types";

const TARGET_COLORS = [
  "#e0af68",
  "#9ece6a",
  "#bb9af7",
  "#f7768e",
  "#7aa2f7",
  "#7dcfff",
];

const targetFiles = import.meta.glob("../../src-tauri/target-reference/*.txt", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function getBuiltInTargets(): TargetTrace[] {
  return Object.entries(targetFiles)
    .sort(([left], [right]) => targetNameFromPath(left).localeCompare(targetNameFromPath(right)))
    .map(([path, text], index) => ({
      id: `target:${targetNameFromPath(path)}`,
      name: targetNameFromPath(path),
      color: TARGET_COLORS[index % TARGET_COLORS.length],
      builtIn: true,
      points: parseMeasurementText(text),
    }));
}

export function nextTargetColor(existingCount: number): string {
  return TARGET_COLORS[existingCount % TARGET_COLORS.length];
}

export function makeTargetName(baseName: string, existing: TargetTrace[]): string {
  const normalized = baseName.trim() || "Target";
  if (!existing.some((target) => target.name === normalized)) {
    return normalized;
  }

  let copyIndex = 2;
  while (existing.some((target) => target.name === `${normalized} ${copyIndex}`)) {
    copyIndex += 1;
  }
  return `${normalized} ${copyIndex}`;
}

function targetNameFromPath(path: string): string {
  return decodeURIComponent(path.split("/").pop() || "Target").replace(/\.txt$/i, "");
}
