import type { ResponseModel } from "@/types";

// Older backend metadata has no model; its graph contract was canonical Q.
export function parseResponseModel(value: unknown): ResponseModel {
  if (value === undefined) return "CanonicalQ";
  if (value === "CanonicalQ" || value === "MoondropShelfSlope") return value;
  throw new Error(
    "Invalid device response model: expected CanonicalQ or MoondropShelfSlope",
  );
}
