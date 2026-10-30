import { parseAutoEqResult } from "@/features/tuning/lib/parsedAutoEq";

/** Validates a parse_autoeq response the same way on every platform. */
export function parseProfileImport(value: unknown, fileName: string) {
  const result = parseAutoEqResult(value);
  return {
    data: result.peq,
    name: result.headphone_name?.trim() || fileName.replace(/\.[^/.]+$/, ""),
    warnings: result.warnings,
  };
}
