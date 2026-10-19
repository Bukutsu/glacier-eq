import { i18n } from "@/lib/i18n";
import type { StoredPEQData } from "@/types";

export function profileOverwriteMessage(
  name: string,
  original: StoredPEQData,
  replacement: StoredPEQData,
): string {
  const removed = original.filters.length - replacement.filters.length;
  if (removed > 0) {
    return i18n.t("library:profileOverwrite.bandLossMessage", {
      name: name,
      originalCount: original.filters.length,
      replacementCount: replacement.filters.length,
      count: removed,
    });
  }
  return i18n.t("library:profileOverwrite.overwriteMessage", { name: name });
}
