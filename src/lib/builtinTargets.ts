import type { TargetTrace } from "../types";
import { parseMeasurementText, resolveTargetColor } from "./measurements";

const rawTargetFiles = import.meta.glob<string>("../../target_references/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
});

function loadBuiltinTargets(): TargetTrace[] {
  const targets: TargetTrace[] = [];
  let index = 0;

  for (const [path, content] of Object.entries(rawTargetFiles)) {
    const filename = path.split("/").pop() ?? "";
    const name = filename.replace(/\.txt$/, "");
    if (!name || !content) continue;

    try {
      const points = parseMeasurementText(content);
      targets.push({
        id: `builtin-target:${name.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        color: resolveTargetColor(index++),
        builtIn: true,
        points,
      });
    } catch (err) {
      console.warn(`Failed to parse builtin target ${name}:`, err);
    }
  }

  // Sort by name for consistent display
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

export const BUILTIN_TARGETS: TargetTrace[] = loadBuiltinTargets();
