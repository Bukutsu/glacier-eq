import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PEQData, SupportedDeviceInfo } from "../types";

const wasm = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  list_supported_devices: vi.fn(),
  parse_autoeq: vi.fn(),
  peq_to_autoeq: vi.fn(),
  normalize_peq_for_device: vi.fn(),
  is_default_peq_for_device: vi.fn(),
  match_profile_name: vi.fn(),
  run_autoeq: vi.fn(),
  build_init_packets: vi.fn(() => []),
  build_read_filter_request: vi.fn(),
  matches_filter_response: vi.fn(),
  parse_filter_response: vi.fn(),
  build_read_global_gain_request: vi.fn(),
  matches_global_gain_response: vi.fn(),
  parse_global_gain_response: vi.fn(),
  build_write_filter_packets: vi.fn(() => []),
  build_write_global_gain_packets: vi.fn(() => []),
  build_commit_packets: vi.fn(() => []),
  build_ram_apply_packets: vi.fn(() => []),
  build_filter_mode_write_packet: vi.fn(),
  build_amp_mode_write_packet: vi.fn(),
  build_gain_mode_write_packet: vi.fn(),
  build_balance_write_packets: vi.fn(),
  build_mic_volume_write_packet: vi.fn(),
  build_factory_reset_packet: vi.fn(),
  build_flash_eq_packet: vi.fn(),
  get_write_timing: vi.fn(() => ({})),
}));

vi.mock("../wasm_pkg/glacier_core", () => ({
  default: wasm.init,
  ...wasm,
}));

import {
  invoke,
  peqVerificationError,
  parseWebProfiles,
  parseWebSettings,
  persistentPushFailureMessage,
  shouldRetryWebHidRead,
  WebHidReadTimeout,
} from "./rpc";

const profile: SupportedDeviceInfo = {
  name: "Test DAC",
  protocol: "TestProtocol",
  vendor_id: 0x1234,
  product_id: 0x5678,
  status: "supported",
  family: "test",
  num_bands: 10,
  global_gain_range: [-16, 6],
  band_gain_range: [-10, 10],
  freq_range: [20, 20_000],
  q_range: [0.1, 20],
  supported_filter_types: ["Peak", "LowShelf", "HighShelf", "HighPass", "LowPass"],
  supports_per_band_enable: true,
  supports_ram_apply: true,
  dsp_sample_rate: 96_000,
  gain_tolerance: 0.15,
  freq_tolerance: 1,
  q_tolerance: 0.05,
  integer_preamp: false,
};

const localStorageValues = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageValues.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => localStorageValues.set(key, value)),
};

const hidListeners = new Map<string, (event: { device: HIDDevice }) => void>();
const hidMock = {
  devices: [] as HIDDevice[],
  addEventListener: vi.fn((event: string, listener: (event: { device: HIDDevice }) => void) => {
    hidListeners.set(event, listener);
  }),
  getDevices: vi.fn(async () => hidMock.devices),
};

function fakeHidDevice(options: { respondToReports?: boolean } = {}): HIDDevice {
  let inputReportListener: ((event: { data: DataView; reportId: number }) => void) | null = null;
  return {
    vendorId: profile.vendor_id,
    productId: profile.product_id!,
    productName: "Browser DAC",
    manufacturerName: "Test",
    opened: true,
    collections: [],
    open: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    receiveFeatureReport: vi.fn(),
    sendFeatureReport: vi.fn(),
    sendReport: vi.fn(async () => {
      if (options.respondToReports && inputReportListener) {
        const bytes = Uint8Array.of(1, 2, 3);
        inputReportListener({ data: new DataView(bytes.buffer), reportId: 1 });
      }
    }),
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === "inputreport" && typeof listener === "function") {
        inputReportListener = listener as (event: { data: DataView; reportId: number }) => void;
      }
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    oninputreport: null,
  };
}

async function connectWebHid(device: HIDDevice, deviceProfile = profile): Promise<void> {
  wasm.list_supported_devices.mockReturnValue([deviceProfile]);
  hidMock.devices = [device];
  const listed = await invoke<Array<{ path: string }>>("list_devices");
  await invoke("connect_device", { path: listed[0].path });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorageValues.clear();
  hidMock.devices = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hid: hidMock },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  wasm.normalize_peq_for_device.mockImplementation((peq) => peq);
  wasm.is_default_peq_for_device.mockReturnValue(false);
  wasm.build_init_packets.mockReturnValue([]);
  wasm.build_write_filter_packets.mockReturnValue([]);
  wasm.build_write_global_gain_packets.mockReturnValue([]);
  wasm.build_commit_packets.mockReturnValue([]);
  wasm.build_ram_apply_packets.mockReturnValue([]);
  wasm.get_write_timing.mockReturnValue({});
});

function peqWithBands(count: number): PEQData {
  return {
    global_gain: -2,
    filters: Array.from({ length: count }, (_, index) => ({
      index,
      enabled: true,
      filter_type: "Peak",
      freq: 100 + index,
      gain: index,
      q: 0.7,
    })),
  };
}

const VERIFICATION_CAPS = {
  supports_per_band_enable: true,
  gain_tolerance: 0.15,
  freq_tolerance: 1,
  q_tolerance: 0.05,
};

function verificationPeq(): PEQData {
  return {
    global_gain: -1,
    filters: [
      { index: 0, enabled: true, filter_type: "LowShelf", freq: 100, gain: 1, q: 0.7 },
      { index: 1, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
    ],
  };
}

describe("browser EQ writes", () => {
  it("normalizes a persistent write before sending and returns the normalized PEQ", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device);
    localStorageValues.set("glacier-eq-settings", JSON.stringify({ skip_push_verification: true }));
    const requested = peqWithBands(1);
    const normalized = { filters: [], global_gain: -4 };
    wasm.normalize_peq_for_device.mockReturnValue(normalized);
    wasm.build_write_global_gain_packets.mockReturnValue([[1, 2]]);

    await expect(invoke<PEQData>("set_eq_state", { peq: requested })).resolves.toEqual(normalized);

    expect(wasm.normalize_peq_for_device).toHaveBeenCalledWith(
      requested,
      profile.vendor_id,
      profile.product_id,
    );
    expect(wasm.build_write_global_gain_packets).toHaveBeenCalledWith(profile.protocol, -4);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { filters: [], global_gain: Number.NaN },
    { filters: [{ index: 0 }], global_gain: 0 },
  ])("rejects malformed persistent input before sending packets", async (peq) => {
    const device = fakeHidDevice();
    await connectWebHid(device);

    await expect(invoke("set_eq_state", { peq })).rejects.toThrow("Invalid PEQ data");

    expect(wasm.normalize_peq_for_device).not.toHaveBeenCalled();
    expect(device.sendReport).not.toHaveBeenCalled();
  });

  it("rejects volatile apply when the active device does not support it", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device, { ...profile, supports_ram_apply: false });

    await expect(invoke("apply_eq_state", { peq: peqWithBands(1) })).rejects.toThrow(
      "does not advertise volatile RAM apply support",
    );

    expect(wasm.normalize_peq_for_device).not.toHaveBeenCalled();
    expect(wasm.build_ram_apply_packets).not.toHaveBeenCalled();
    expect(device.sendReport).not.toHaveBeenCalled();
  });

  it("normalizes volatile apply before sending and returns the normalized PEQ", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device);
    const normalized = { filters: [], global_gain: -3 };
    wasm.normalize_peq_for_device.mockReturnValue(normalized);
    wasm.build_ram_apply_packets.mockReturnValue([[1, 9]]);

    await expect(invoke<PEQData>("apply_eq_state", { peq: peqWithBands(1) })).resolves.toEqual(normalized);

    expect(wasm.build_write_global_gain_packets).toHaveBeenCalledWith(profile.protocol, -3);
    expect(wasm.build_ram_apply_packets).toHaveBeenCalledWith(profile.protocol);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
  });
});

describe("peqVerificationError", () => {
  it("accepts protocol readback within the capability tolerances", () => {
    const actual = verificationPeq();
    actual.filters[0] = { ...actual.filters[0], freq: 101, gain: 1.149, q: 0.749 };

    expect(peqVerificationError(actual, verificationPeq(), VERIFICATION_CAPS)).toBeNull();
  });

  it("treats a disabled band's expected gain as zero", () => {
    const expected = verificationPeq();
    expected.filters[1].gain = 8;

    expect(peqVerificationError(verificationPeq(), expected, VERIFICATION_CAPS)).toBeNull();
  });

  it.each([
    ["global gain", (peq: PEQData) => { peq.global_gain = -0.9; }],
    ["filter count", (peq: PEQData) => { peq.filters.pop(); }],
    ["enabled state", (peq: PEQData) => { peq.filters[0].enabled = false; }],
    ["filter type", (peq: PEQData) => { peq.filters[0].filter_type = "Peak"; }],
    ["frequency", (peq: PEQData) => { peq.filters[0].freq = 102; }],
    ["gain", (peq: PEQData) => { peq.filters[0].gain = 1.16; }],
    ["Q", (peq: PEQData) => { peq.filters[0].q = 0.76; }],
  ])("rejects a %s mismatch", (_field, mutate) => {
    const actual = verificationPeq();
    mutate(actual);

    expect(peqVerificationError(actual, verificationPeq(), VERIFICATION_CAPS)).not.toBeNull();
  });

  it("ignores enabled readback when the protocol represents disable as zero gain", () => {
    const actual = verificationPeq();
    actual.filters[1].enabled = true;

    expect(peqVerificationError(actual, verificationPeq(), {
      ...VERIFICATION_CAPS,
      supports_per_band_enable: false,
    })).toBeNull();
  });
});

describe("web settings parser", () => {
  it("ignores wrong-shaped fields and never enables malformed verification skipping", () => {
    const parsed = parseWebSettings({
      auto_pull_on_connect: false,
      skip_push_verification: "true",
      theme: "dracula",
      snap_to_iso_frequencies: 1,
      unknown_setting: true,
    });

    expect(parsed.malformed).toBe(true);
    expect(parsed.value).toEqual({
      auto_pull_on_connect: false,
      skip_push_verification: false,
      theme: "dracula",
      snap_to_iso_frequencies: true,
      floating_graph_preview: true,
    });
  });

  it("falls back safely when settings are not an object", () => {
    const parsed = parseWebSettings(["skip_push_verification"]);

    expect(parsed.malformed).toBe(true);
    expect(parsed.value.skip_push_verification).toBe(false);
  });
});

describe("web profile parser", () => {
  const validProfile = {
    name: "Desk EQ",
    modified: 123,
    data: {
      globalGain: -2,
      filters: [
        { index: 0, enabled: true, type: "LSQ", freq: 80, gain: -1.5, q: 0.7 },
      ],
    },
  };

  it("normalizes Rust field and filter-type aliases", () => {
    const parsed = parseWebProfiles([validProfile]);

    expect(parsed.malformed).toBe(false);
    expect(parsed.value).toEqual([{
      name: "Desk EQ",
      modified: 123,
      data: {
        global_gain: -2,
        filters: [
          { index: 0, enabled: true, filter_type: "LowShelf", freq: 80, gain: -1.5, q: 0.7 },
        ],
      },
    }]);
  });

  it("retains valid entries while rejecting malformed profiles", () => {
    const malformedFilter = {
      ...validProfile,
      name: "Broken EQ",
      data: {
        ...validProfile.data,
        filters: [{ ...validProfile.data.filters[0], gain: "loud" }],
      },
    };
    const malformedModified = { ...validProfile, name: "No Date", modified: "today" };
    const parsed = parseWebProfiles([malformedFilter, validProfile, malformedModified]);

    expect(parsed.malformed).toBe(true);
    expect(parsed.value.map((profile) => profile.name)).toEqual(["Desk EQ"]);
  });

  it("rejects profiles the 32-filter storage format cannot retain", () => {
    const oversized = {
      ...validProfile,
      data: {
        ...validProfile.data,
        filters: Array.from({ length: 33 }, (_, index) => ({
          ...validProfile.data.filters[0],
          index,
        })),
      },
    };

    expect(parseWebProfiles([oversized])).toEqual({ value: [], malformed: true });
  });

  it("rejects a wrong-shaped profile collection", () => {
    expect(parseWebProfiles({ profiles: [validProfile] })).toEqual({
      value: [],
      malformed: true,
    });
  });
});

describe("WebHID report retry classification", () => {
  it("retries its own timeout while connected", () => {
    expect(shouldRetryWebHidRead(new WebHidReadTimeout(), true)).toBe(true);
  });

  it("does not retry timeouts after disconnection", () => {
    expect(shouldRetryWebHidRead(new WebHidReadTimeout(), false)).toBe(false);
  });

  it("does not swallow transport failures", () => {
    expect(shouldRetryWebHidRead(new Error("sendReport failed"), true)).toBe(false);
  });
});

describe("persistentPushFailureMessage", () => {
  it("reports a successful restore", () => {
    expect(persistentPushFailureMessage(new Error("write failed"), null)).toBe(
      "Persistent push failed: write failed; previous state restored",
    );
  });

  it("reports a failed restore", () => {
    expect(persistentPushFailureMessage("commit failed", new Error("device disconnected"))).toBe(
      "Persistent push failed: commit failed; restore failed: device disconnected",
    );
  });
});
