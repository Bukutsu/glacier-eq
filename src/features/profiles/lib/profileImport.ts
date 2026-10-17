import { parseStoredPeqResponse } from "@/features/eq/lib/peq";

export function parseProfileImport(value: unknown, fileName: string) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("peq" in value) ||
    !("warnings" in value) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(
      (warning): warning is string => typeof warning === "string",
    ) ||
    !("headphone_name" in value) ||
    (value.headphone_name !== null && typeof value.headphone_name !== "string")
  )
    throw new Error("Invalid AutoEQ import response");
  return {
    data: parseStoredPeqResponse(value.peq),
    name: value.headphone_name?.trim() || fileName.replace(/\.[^/.]+$/, ""),
    warnings: value.warnings,
  };
}
