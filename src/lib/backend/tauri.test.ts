import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "./tauri";

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => backend);
beforeEach(() => vi.clearAllMocks());

describe("native device response model boundary", () => {
  it.each(["list_devices", "list_supported_devices"])(
    "validates %s metadata without changing older entries",
    async (cmd) => {
      for (const response_model of [
        undefined,
        "CanonicalQ",
        "MoondropShelfSlope",
      ]) {
        const metadata = [{ response_model }];
        backend.invoke.mockResolvedValueOnce(metadata);
        expect(await invoke(cmd)).toBe(metadata);
      }
      for (const response_model of [null, "unknown", 42, {}]) {
        backend.invoke.mockResolvedValueOnce([{ response_model }]);
        await expect(invoke(cmd)).rejects.toThrow(
          "Invalid device response model",
        );
      }
    },
  );
});
