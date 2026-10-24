import type { DeviceInfo } from "@/types";
import { OFFLINE_EDITOR_CAPABILITIES } from "./dacSpecs";

/** Complete metadata; override only fields relevant to the test. */
export function makeDeviceInfo(
  overrides: Partial<DeviceInfo> = {},
): DeviceInfo {
  return {
    ...OFFLINE_EDITOR_CAPABILITIES,
    vendor_id: 0x2972,
    product_id: 0x0102,
    path: "/test-dac",
    manufacturer: null,
    product_string: null,
    profile_name: null,
    hardware_eq: true,
    controls: null,
    spec: null,
    user_eq_slots: [],
    ...overrides,
  };
}
