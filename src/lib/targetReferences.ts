import { cssVar } from "./theme";
import { parseMeasurementText } from "./measurements";
import type { TargetTrace } from "../types";

const TARGET_COLOR_VARS = ["--yellow", "--green", "--purple", "--red", "--blue", "--cyan"];
/**
 * Fallback hex values matching the current Tokyo Night palette.
 * Used only when the CSS variable cannot be resolved (SSR / edge case).
 */
const TARGET_FALLBACKS = ["#e0af68", "#9ece6a", "#bb9af7", "#f7768e", "#7aa2f7", "#7dcfff"];

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
      color: resolveTargetColor(index),
      builtIn: true,
      points: parseMeasurementText(text),
    }));
}

export function nextTargetColor(existingCount: number): string {
  return resolveTargetColor(existingCount);
}

function resolveTargetColor(index: number): string {
  const idx = index % TARGET_COLOR_VARS.length;
  return cssVar(TARGET_COLOR_VARS[idx], TARGET_FALLBACKS[idx]);
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
