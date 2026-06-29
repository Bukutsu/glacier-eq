import { makeUniqueName, parseMeasurementText } from "./measurements";
import type { TargetTrace } from "../types";

const TARGET_COLOR_VARS = ["--yellow", "--green", "--purple", "--red", "--blue", "--cyan"];

const targetFiles = import.meta.glob("../../src-tauri/target-reference/*.txt", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function getBuiltInTargets(): TargetTrace[] {
  return Object.entries(targetFiles)
    .sort(([left], [right]) => targetNameFromPath(left).localeCompare(targetNameFromPath(right)))
    .map(([path, text], index) => {
      const name = targetNameFromPath(path);
      return {
        id: `target:${name}`,
        name,
        color: resolveTargetColor(index),
        builtIn: true,
        points: parseMeasurementText(text),
      };
    });
}

export function nextTargetColor(existingCount: number): string {
  return resolveTargetColor(existingCount);
}

function resolveTargetColor(index: number): string {
  const idx = index % TARGET_COLOR_VARS.length;
  return `var(${TARGET_COLOR_VARS[idx]})`;
}

export function makeTargetName(baseName: string, existing: TargetTrace[]): string {
  return makeUniqueName(baseName, existing.map((target) => target.name), "Target");
}

function targetNameFromPath(path: string): string {
  return decodeURIComponent(path.split("/").pop() || "Target").replace(/\.txt$/i, "");
}
