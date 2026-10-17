import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupportedDeviceInfo } from "@/types";
import {
  DEV_DUMMY_DEVICE,
  buildDevPreviewDevice,
  invokeDevDummy,
  isDevDummyDevice,
  readDevDummyPeq,
  writeDevDummyPeq,
  reconnectDevDummyDevice,
} from "./devDevice";
import { invokeForDevice } from "@/lib/rpc";

const backend = vi.hoisted(() => ({
  invoke: vi.fn(async () => "native result"),
}));
vi.mock("@glacier-eq/backend", () => backend);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

let counter = 0;
function model(
  protocol = "Walkplay",
  num_bands = 10,
  overrides: Partial<SupportedDeviceInfo> = {},
) {
  const profile: SupportedDeviceInfo = {
    ...DEV_DUMMY_DEVICE,
    name: "Preview test " + counter++,
    protocol,
    status: "Tested",
    family: "test",
    num_bands,
    vendor_id: protocol === "Moondrop Dawn Pro" ? 0x2fc6 : 0x3302,
    product_id: protocol === "Moondrop Dawn Pro" ? 0xf06a : null,
    hardware_eq: protocol !== "Moondrop Dawn Pro",
    controls:
      protocol === "Walkplay"
        ? "walkplay"
        : protocol === "Moondrop Dawn Pro"
          ? "dawn_pro"
          : null,
    integer_preamp: false,
    ...overrides,
  };
  return buildDevPreviewDevice(profile);
}

describe("development DAC previews", () => {
  it("reads and applies JA11 preview controls locally, preserving them on refresh", async () => {
    const device = model("FiiO JA11", 5, { controls: "ja11" });
    for (const [control, initial, target] of [
      ["microphone", 1, 0],
      ["uac", 1, 0],
      ["volume", 30, 24],
    ] as const) {
      await expect(
        invokeForDevice(device.path, "ja11_control", { control }),
      ).resolves.toBe(initial);
      await expect(
        invokeForDevice(device.path, "ja11_control", {
          control,
          value: target,
        }),
      ).resolves.toBe(target);
      await expect(
        invokeForDevice(device.path, "ja11_control", { control }),
      ).resolves.toBe(target);
    }
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it("isolates JA11 preview state and resets controls on reconnect", () => {
    const first = model("FiiO JA11", 5, { controls: "ja11" }),
      second = model("FiiO JA11", 5, { controls: "ja11" });
    invokeDevDummy(first.path, "ja11_control", {
      control: "volume",
      value: 12,
    });
    expect(
      invokeDevDummy(second.path, "ja11_control", { control: "volume" }),
    ).toBe(30);
    reconnectDevDummyDevice(first.path);
    expect(
      invokeDevDummy(first.path, "ja11_control", { control: "volume" }),
    ).toBe(30);
    invokeDevDummy(first.path, "ja11_control", {
      control: "microphone",
      value: 0,
    });
    invokeDevDummy(first.path, "reset_device_controls");
    expect(
      invokeDevDummy(first.path, "ja11_control", { control: "microphone" }),
    ).toBe(1);
  });

  it("rejects unsupported JA11 preview commands and invalid values without touching hardware", async () => {
    const device = model("FiiO JA11", 5, { controls: "ja11" });
    for (const [control, value] of [
      ["volume", 61],
      ["volume", -1],
      ["volume", 1.5],
      ["uac", 2],
      ["microphone", 2],
      ["unknown", 0],
    ]) {
      await expect(
        invokeForDevice(device.path, "ja11_control", { control, value }),
      ).rejects.toThrow();
    }
    expect(
      invokeDevDummy(device.path, "ja11_control", { control: "volume" }),
    ).toBe(30);
    await expect(
      invokeForDevice(model("FiiO KA17").path, "ja11_control", {
        control: "volume",
      }),
    ).rejects.toThrow("JA11 preview");
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "Walkplay",
    "Moondrop",
    "Moondrop Dawn Pro",
    "FiiO",
    "FiiO JA11",
    "FiiO KA17",
  ])(
    "builds a selectable, virtual %s model using registry capabilities",
    (protocol) => {
      const device = model(protocol, protocol === "Moondrop" ? 8 : 10);
      expect(isDevDummyDevice(device.path)).toBe(true);
      if (protocol === "Moondrop Dawn Pro")
        expect(device.product_id).toBe(0xf06a);
      else
        expect(readDevDummyPeq(device.path).filters).toHaveLength(
          device.num_bands,
        );
    },
  );

  it("refuses EQ on a model without hardware EQ", () => {
    const device = model("Moondrop Dawn Pro");
    const flat = { global_gain: 0, filters: [] };
    expect(() => readDevDummyPeq(device.path)).toThrow("has no hardware EQ");
    expect(() => writeDevDummyPeq(device.path, flat)).toThrow(
      "has no hardware EQ",
    );
    expect(() => invokeDevDummy(device.path, "reset_device_eq")).toThrow(
      "has no hardware EQ",
    );
  });

  it("keeps model state independent and returns defensive snapshots", () => {
    const first = model(),
      second = model();
    invokeDevDummy(first.path, "set_dac_output_gain", { isHighGain: true });
    expect(invokeDevDummy(first.path, "get_dac_utility_state")).toMatchObject({
      high_gain_mode: true,
    });
    expect(invokeDevDummy(second.path, "get_dac_utility_state")).toMatchObject({
      high_gain_mode: false,
    });
    const data = readDevDummyPeq(first.path);
    data.filters[0].gain = 123;
    expect(readDevDummyPeq(first.path).filters[0].gain).not.toBe(123);
  });

  it("persists EQ writes, models temporary EQ, and restores saved EQ on reconnect", () => {
    const device = model("FiiO KA17", 20);
    const saved = readDevDummyPeq(device.path);
    saved.filters[0].gain = -6;
    writeDevDummyPeq(device.path, saved);
    expect(readDevDummyPeq(device.path).filters[0].gain).toBe(-6);
    const temporary = structuredClone(saved);
    temporary.filters[0].gain = -3;
    writeDevDummyPeq(device.path, temporary, false);
    expect(readDevDummyPeq(device.path).filters[0].gain).toBe(-3);
    reconnectDevDummyDevice(device.path);
    expect(readDevDummyPeq(device.path).filters[0].gain).toBe(-6);
  });

  it("clamps EQ writes to the selected model's band count and ranges", () => {
    const device = model("FiiO JA11", 5);
    const data = readDevDummyPeq(device.path);
    data.global_gain = 100;
    data.filters[0].gain = 100;
    data.filters.push(...structuredClone(data.filters));
    const written = writeDevDummyPeq(device.path, data);
    expect(written.filters).toHaveLength(5);
    expect(written.global_gain).toBe(device.global_gain_range[1]);
    expect(written.filters[0].gain).toBe(device.band_gain_range[1]);
  });

  it("exercises every Walkplay sound control", () => {
    const device = model();
    invokeDevDummy(device.path, "set_dac_filter_mode", { mode: "NON-OS" });
    invokeDevDummy(device.path, "set_dac_work_mode", { isClassAb: true });
    invokeDevDummy(device.path, "set_dac_output_gain", { isHighGain: true });
    invokeDevDummy(device.path, "set_dac_balance", { balance: -4 });
    invokeDevDummy(device.path, "set_mic_volume", { volumeDb: -6 });
    expect(invokeDevDummy(device.path, "get_dac_utility_state")).toEqual({
      supported: true,
      filter_mode: "NON-OS",
      amp_mode_class_ab: true,
      high_gain_mode: true,
      channel_balance: -4,
      mic_volume_db: -6,
    });
  });

  it("exercises all original-Dawn controls with the canonical volume curve", () => {
    const device = model("Moondrop Dawn Pro");
    invokeDevDummy(device.path, "set_dawn_pro_control", {
      control: "filter",
      value: 4,
    });
    invokeDevDummy(device.path, "set_dawn_pro_control", {
      control: "gain",
      value: 1,
    });
    invokeDevDummy(device.path, "set_dawn_pro_control", {
      control: "led",
      value: 2,
    });
    const source = readFileSync(
      new URL(
        "../../../../glacier-core/src/device/families/dawn_pro/mod.rs",
        import.meta.url,
      ),
      "utf8",
    );
    const codes = source
      .match(/const VOLUME_CODES:[^=]*= \[([\s\S]*?)\];/)![1]
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean)
      .map(Number);
    expect(codes).toHaveLength(61);
    for (let step = 0; step <= 60; step++) {
      expect(
        invokeDevDummy(device.path, "set_dawn_pro_control", {
          control: "volume",
          value: step,
        }),
      ).toEqual({
        filter: 4,
        high_gain: true,
        led: 2,
        volume_step: step,
        volume_raw: codes[step],
      });
    }
  });

  it("does not invent sound controls for EQ-only protocol UIs", () => {
    for (const protocol of ["Moondrop", "FiiO", "FiiO JA11", "FiiO KA17"]) {
      const device = model(protocol);
      expect(
        invokeDevDummy(device.path, "get_dac_utility_state"),
      ).toMatchObject({ supported: false });
      expect(() =>
        invokeDevDummy(device.path, "set_dac_output_gain", {
          isHighGain: true,
        }),
      ).toThrow("Walkplay controls");
    }
  });

  it("resets controls and EQ without touching other preview models", () => {
    const first = model(),
      second = model();
    invokeDevDummy(first.path, "set_dac_balance", { balance: 10 });
    invokeDevDummy(first.path, "execute_factory_reset");
    expect(invokeDevDummy(first.path, "get_dac_utility_state")).toMatchObject({
      channel_balance: 0,
    });
    const flat = readDevDummyPeq(first.path);
    expect(flat.global_gain).toBe(0);
    expect(flat.filters.every((filter) => filter.gain === 0)).toBe(true);
    expect(
      readDevDummyPeq(second.path).filters.some((filter) => filter.gain !== 0),
    ).toBe(true);
  });

  it("rejects invalid values before changing simulated state", () => {
    const device = model("Moondrop Dawn Pro");
    const before = invokeDevDummy(device.path, "get_dawn_pro_state");
    expect(() =>
      invokeDevDummy(device.path, "set_dawn_pro_control", {
        control: "volume",
        value: 61,
      }),
    ).toThrow();
    expect(() =>
      invokeDevDummy(device.path, "set_dawn_pro_control", {
        control: "gain",
        value: -1,
      }),
    ).toThrow();
    expect(invokeDevDummy(device.path, "get_dawn_pro_state")).toEqual(before);
  });

  it("routes virtual commands locally and physical commands to the backend", async () => {
    const device = model();
    await invokeForDevice(device.path, "set_dac_balance", { balance: 2 });
    expect(backend.invoke).not.toHaveBeenCalled();
    await expect(
      invokeForDevice("/real-hid", "get_dac_utility_state"),
    ).resolves.toBe("native result");
    expect(backend.invoke).toHaveBeenCalledWith(
      "get_dac_utility_state",
      undefined,
    );
  });

  it("never falls through for unknown virtual paths or commands", async () => {
    await expect(
      invokeForDevice(
        DEV_DUMMY_DEVICE.path + "/missing",
        "get_dac_utility_state",
      ),
    ).rejects.toThrow("Unknown DAC preview");
    await expect(
      invokeForDevice(DEV_DUMMY_DEVICE.path, "send_raw_hid"),
    ).rejects.toThrow("not implemented");
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it("cannot send virtual commands to hardware in a production build", async () => {
    vi.stubEnv("DEV", false);
    expect(isDevDummyDevice(DEV_DUMMY_DEVICE.path)).toBe(false);
    await expect(
      invokeForDevice(DEV_DUMMY_DEVICE.path, "reset_device_eq"),
    ).rejects.toThrow("development DAC preview");
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it("keeps same-name exact and vendor-fallback previews separate", () => {
    const exact = model("Moondrop Dawn Pro", 10, {
      name: "Same name",
      product_id: 0xf06a,
      controls: "dawn_pro",
    });
    const fallback = model("Moondrop Dawn Pro", 10, {
      name: "Same name",
      product_id: null,
      controls: null,
    });
    expect(exact.path).not.toBe(fallback.path);
    expect(invokeDevDummy(exact.path, "get_dawn_pro_state")).toMatchObject({
      high_gain: false,
    });
    expect(() => invokeDevDummy(fallback.path, "get_dawn_pro_state")).toThrow(
      "These controls require an original-Dawn preview",
    );
  });

  it("previews a new protocol without inheriting Walkplay controls", () => {
    const device = model("New protocol");
    expect(readDevDummyPeq(device.path).filters).toHaveLength(device.num_bands);
    expect(invokeDevDummy(device.path, "get_dac_utility_state")).toMatchObject({
      supported: false,
    });
    expect(() =>
      invokeDevDummy(device.path, "set_dac_work_mode", { isClassAb: true }),
    ).toThrow("does not expose Walkplay controls");
  });
});
