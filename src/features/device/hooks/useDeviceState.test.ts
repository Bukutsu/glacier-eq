import { describe, expect, it, vi } from "vitest";
import { DEV_DUMMY_DEVICE } from "@/features/device/lib/devDevice";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import { useDeviceState } from "./useDeviceState";

const state = vi.hoisted(() => ({
  index: 0,
  values: [] as unknown[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => [
    state.index < state.values.length ? state.values[state.index++] : initial,
    vi.fn(),
  ],
  useRef: (current: unknown) => ({ current }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
}));

describe("editor capability derivation", () => {
  it.each([true, false])(
    "uses protocol model only when connected=%s",
    (connected) => {
      const device = {
        ...DEV_DUMMY_DEVICE,
        response_model: "MoondropShelfSlope" as const,
      };
      state.index = 0;
      state.values = [[device], device.path, connected];
      const result = useDeviceState();
      expect(result.selectedCapabilities.response_model).toBe(
        "MoondropShelfSlope",
      );
      expect(result.capabilities).toBe(
        connected ? device : OFFLINE_EDITOR_CAPABILITIES,
      );
      expect(result.capabilities.response_model).toBe(
        connected ? "MoondropShelfSlope" : "CanonicalQ",
      );
    },
  );
});
