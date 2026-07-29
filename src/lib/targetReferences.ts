import { makeUniqueName } from "./measurements";
import type { TargetTrace } from "../types";

const TARGET_COLOR_VARS = ["--yellow", "--green", "--purple", "--red", "--blue", "--cyan"];

export function resolveTargetColor(index: number): string {
  const idx = index % TARGET_COLOR_VARS.length;
  return `var(${TARGET_COLOR_VARS[idx]})`;
}

export function makeTargetName(baseName: string, existing: TargetTrace[]): string {
  return makeUniqueName(baseName, existing.map((target) => target.name), "Target");
}
