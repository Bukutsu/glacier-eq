import type { StoredPEQData } from "../types";

export function profileOverwriteMessage(name: string, original: StoredPEQData, replacement: StoredPEQData): string {
  const removed = original.filters.length - replacement.filters.length;
  if (removed > 0) {
    return `The saved profile "${name}" has ${original.filters.length} bands, but the editor has ${replacement.filters.length}. Overwriting will permanently remove ${removed} bands. Save as a copy to retain the original profile, or confirm the overwrite.`;
  }
  return `A profile named "${name}" already exists. Overwrite it?`;
}
