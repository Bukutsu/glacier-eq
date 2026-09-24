import { describe, expect, it } from "vitest";
import { chooseReconnectDevice } from "./reconnectDevice";

const devices = [
  { path: "a", profile_name: "Same DAC", product_string: "Same DAC" },
  { path: "b", profile_name: "Same DAC", product_string: "Same DAC" },
];

describe("chooseReconnectDevice", () => {
  it("prefers the previously connected path when it is present", () => {
    expect(chooseReconnectDevice(devices, "b", "Same DAC")?.path).toBe("b");
  });

  it("does not choose arbitrarily when multiple same-model devices are present", () => {
    expect(chooseReconnectDevice(devices, "missing", "Same DAC")).toBeNull();
  });

  it("allows a single device fallback when no identity was retained", () => {
    expect(chooseReconnectDevice([devices[0]], "", "")?.path).toBe("a");
  });
});
