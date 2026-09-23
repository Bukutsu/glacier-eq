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

vi.mock("../../wasm_pkg/glacier_core", () => ({
  default: wasm.init,
  ...wasm,
}));

// Controllable wasm gate: the round-5 P3 finding is that invokeWeb awaited
// ensureWasm() even for pure-JS diagnostics commands, so a failed wasm fetch
// blanked the ToolsPanel history view. Default path delegates to the real
// ensureWasm (which imports the mocked wasm_pkg above); setting
// wasmGate.failure simulates the outage.
const wasmGate = vi.hoisted(() => ({ failure: null as Error | null }));

vi.mock("./wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wasm")>();
  return {
    ...actual,
    ensureWasm: async () => {
      if (wasmGate.failure) throw wasmGate.failure;
      await actual.ensureWasm();
    },
  };
});

import {
  invoke,
  matchSupportedWebHidDevice,
  openUrl,
  peqVerificationError,
  parseWebProfiles,
  parseWebSettings,
  persistentPushFailureMessage,
  shouldRetryWebHidRead,
  WebHidReadTimeout,
} from "./web";
import { parseDiagnosticHistory } from "../diagnostics";

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
  wasm.normalize_peq_for_device.mockImplementation((peq) => ({ peq, warnings: [] }));
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

describe("browser connection cleanup", () => {
  it("does not close a newer device when stale cleanup names the old path", async () => {
    const first = fakeHidDevice();
    const second = fakeHidDevice();
    wasm.list_supported_devices.mockReturnValue([profile]);
    hidMock.devices = [first, second];
    const paths = await invoke<Array<{ path: string }>>("list_devices");
    await invoke("connect_device", { path: paths[0].path });
    await invoke("connect_device", { path: paths[1].path });
    await invoke("disconnect_device", { expectedPath: paths[0].path });
    expect(second.close).not.toHaveBeenCalled();
    await invoke("disconnect_device", { expectedPath: paths[1].path });
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("releases local state and reports a transport close failure", async () => {
    const device = fakeHidDevice();
    (device.close as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("busy"));
    wasm.list_supported_devices.mockReturnValue([profile]);
    hidMock.devices = [device];
    const paths = await invoke<Array<{ path: string }>>("list_devices");
    await invoke("connect_device", { path: paths[0].path });
    await expect(invoke("disconnect_device")).rejects.toThrow("busy");
    // Local state is released despite the failure: a second disconnect is a
    // no-op instead of retrying the close.
    await invoke("disconnect_device");
    expect(device.close).toHaveBeenCalledOnce();
  });

  it("closes the WebHID handle when a send failure disconnects a present device", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device);
    localStorageValues.set("glacier-eq-settings", JSON.stringify({ skip_push_verification: true }));
    // Transient send failure while the device is still enumerated (e.g. a USB
    // glitch that recovers): the session ends, but the OS interface must be
    // released — afterwards nothing can close this handle again.
    (device.sendReport as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("transfer failed"),
    );
    wasm.normalize_peq_for_device.mockReturnValue({
      peq: { filters: [], global_gain: 0 },
      warnings: [],
    });
    wasm.build_write_global_gain_packets.mockReturnValue([[1, 2]]);

    await expect(invoke("set_eq_state", { peq: peqWithBands(1) })).rejects.toThrow(
      "transfer failed",
    );

    expect(device.close).toHaveBeenCalledOnce();
    // A later disconnect is a no-op (activeDevice already null) — it must not
    // close again, and the first close must not have been skipped.
    await invoke("disconnect_device");
    expect(device.close).toHaveBeenCalledOnce();
  });
});

describe("browser profile matching", () => {
  it("returns null when WASM has no matching profile", async () => {
    wasm.match_profile_name.mockReturnValue(undefined);
    await expect(invoke("match_profile_name", { peq: peqWithBands(1) })).resolves.toBeNull();
  });

  it("preserves a matching profile name", async () => {
    wasm.match_profile_name.mockReturnValue("Saved profile");
    await expect(invoke("match_profile_name", { peq: peqWithBands(1) }))
      .resolves.toBe("Saved profile");
  });
});

describe("browser EQ writes", () => {
  it("rotates filter nonces across complete reads", async () => {
    const device = fakeHidDevice({ respondToReports: true });
    await connectWebHid(device);
    wasm.build_read_global_gain_request.mockReturnValue([1]);
    wasm.matches_global_gain_response.mockReturnValue(true);
    wasm.parse_global_gain_response.mockReturnValue(0);
    wasm.build_read_filter_request.mockReturnValue([1]);
    wasm.matches_filter_response.mockReturnValue(true);
    wasm.parse_filter_response.mockReturnValue({
      index: 0,
      enabled: true,
      filter_type: "Peak",
      freq: 100,
      gain: 0,
      q: 1,
    });
    wasm.is_default_peq_for_device.mockReturnValue(false);

    await invoke("get_eq_state");
    await invoke("get_eq_state");

    const nonces = wasm.build_read_filter_request.mock.calls.map((call) => call[2]);
    expect(nonces).toEqual([...Array(10)].map((_, index) => index + 1).concat(
      [...Array(10)].map((_, index) => index + 11),
    ));
  });

  it("normalizes a persistent write before sending and returns the normalized PEQ", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device);
    localStorageValues.set("glacier-eq-settings", JSON.stringify({ skip_push_verification: true }));
    const requested = peqWithBands(1);
    const normalized = { filters: [], global_gain: -4 };
    wasm.normalize_peq_for_device.mockReturnValue({ peq: normalized, warnings: [] });
    wasm.build_write_global_gain_packets.mockReturnValue([[1, 2]]);

    await expect(invoke<PEQData>("set_eq_state", { peq: requested })).resolves.toEqual({
      ...normalized,
      warnings: [],
    });

    expect(wasm.normalize_peq_for_device).toHaveBeenCalledWith(
      requested,
      profile.vendor_id,
      profile.product_id,
    );
    expect(wasm.build_write_global_gain_packets).toHaveBeenCalledWith(profile.protocol, -4);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
  });

  it("returns the verified readback after a persistent write", async () => {
    const device = fakeHidDevice({ respondToReports: true });
    await connectWebHid(device);
    const requested = peqWithBands(10);
    const readback = {
      ...requested,
      filters: requested.filters.map((filter) => ({ ...filter, gain: filter.gain - 0.1 })),
    };
    wasm.normalize_peq_for_device.mockReturnValue({ peq: requested, warnings: [] });
    wasm.build_read_global_gain_request.mockReturnValue([1]);
    wasm.matches_global_gain_response.mockReturnValue(true);
    wasm.parse_global_gain_response.mockReturnValue(requested.global_gain);
    wasm.build_read_filter_request.mockReturnValue([1]);
    wasm.matches_filter_response.mockReturnValue(true);
    let readCount = 0;
    wasm.parse_filter_response.mockImplementation(
      () => readback.filters[readCount++ % readback.filters.length],
    );
    wasm.is_default_peq_for_device.mockReturnValue(false);

    await expect(invoke<PEQData>("set_eq_state", { peq: requested })).resolves.toMatchObject({
      global_gain: requested.global_gain,
      filters: readback.filters,
      warnings: [],
    });
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
    wasm.normalize_peq_for_device.mockReturnValue({ peq: normalized, warnings: [] });
    wasm.build_ram_apply_packets.mockReturnValue([[1, 9]]);

    await expect(invoke<PEQData>("apply_eq_state", { peq: peqWithBands(1) })).resolves.toEqual({
      ...normalized,
      warnings: [],
    });

    expect(wasm.build_write_global_gain_packets).toHaveBeenCalledWith(profile.protocol, -3);
    expect(wasm.build_ram_apply_packets).toHaveBeenCalledWith(profile.protocol);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
  });

  it("returns capability-clamp warnings on the push result instead of discarding them", async () => {
    const device = fakeHidDevice();
    await connectWebHid(device);
    localStorageValues.set("glacier-eq-settings", JSON.stringify({ skip_push_verification: true }));
    const clamps = ["Clamped preamp gain from 20.0 dB to 12.0 dB"];
    wasm.normalize_peq_for_device.mockReturnValue({
      peq: { filters: [], global_gain: 12 },
      warnings: clamps,
    });
    wasm.build_write_global_gain_packets.mockReturnValue([[1, 2]]);

    const result = await invoke<{ global_gain: number; warnings?: string[] }>("set_eq_state", {
      peq: peqWithBands(1),
    });

    // The old path returned the bare PEQ: the clamp silently rewrote the
    // value and the UI's "Saved EQ to DAC" was the only signal.
    expect(result.warnings).toEqual(clamps);
    expect(result.global_gain).toBe(12);
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
      // The wrong-typed known fields still fall back to defaults, but the
      // unknown key is data a future build wrote — it survives alongside
      // the fallback instead of being destroyed with the quarantine.
      unknown_setting: true,
    });
  });

  it("preserves unknown settings keys without flagging corruption, like desktop's serde flatten", () => {
    const parsed = parseWebSettings({
      theme: "nord",
      future_setting_from_a_newer_build: { nested: [1, 2] },
    });

    // Desktop keeps unknown keys (settings.rs extra flatten) and never
    // quarantines for them; an unknown key alone must not trigger
    // quarantine on web either.
    expect(parsed.malformed).toBe(false);
    expect(parsed.value).toMatchObject({
      theme: "nord",
      future_setting_from_a_newer_build: { nested: [1, 2] },
    });
  });

  it("preserves the Material You selection for Android webviews without native colors", () => {
    const parsed = parseWebSettings({ theme: "material-you" });

    expect(parsed.malformed).toBe(false);
    expect(parsed.value.theme).toBe("material-you");
  });

  it("falls back safely when settings are not an object", () => {
    const parsed = parseWebSettings(["skip_push_verification"]);

    expect(parsed.malformed).toBe(true);
    expect(parsed.value.skip_push_verification).toBe(false);
  });

  it("round-trips an unknown settings key through get/save without quarantining it", async () => {
    localStorageValues.set(
      "glacier-eq-settings",
      JSON.stringify({ theme: "dracula", future_setting: 42 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const loaded = await invoke<Record<string, unknown>>("get_settings");
    expect(loaded.future_setting).toBe(42);

    await invoke("save_settings", { settings: loaded });
    const stored = JSON.parse(
      localStorageValues.get("glacier-eq-settings") ?? "{}",
    ) as Record<string, unknown>;
    expect(stored.future_setting).toBe(42);
    expect(stored.theme).toBe("dracula");
    // Desktop's extra-flatten contract: the key never became "corrupt",
    // so no quarantine backup was created for it.
    const backup = [...localStorageValues.entries()].find(([key]) =>
      key.startsWith("glacier-eq-settings-malformed-"),
    );
    expect(backup).toBeUndefined();
    warnSpy.mockRestore();
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

  it("clamps loaded profiles to the storage envelope like the desktop store", () => {
    // read_profile (profiles.rs) clamps every load to the storage envelope;
    // the web load path must clamp identically so a hand-edited or legacy
    // localStorage profile cannot smuggle out-of-envelope values past load.
    localStorageValues.set("glacier-eq-profiles", JSON.stringify([{
      name: "Wild",
      modified: 1,
      data: {
        global_gain: 99,
        filters: [
          { index: 0, enabled: true, type: "PK", freq: 60_000, gain: -99, q: 50 },
          { index: 1, enabled: true, type: "PK", freq: 5, gain: 99, q: 0.05 },
        ],
      },
    }]));

    const parsed = parseWebProfiles(
      JSON.parse(localStorageValues.get("glacier-eq-profiles") ?? "[]"),
    );
    expect(parsed.malformed).toBe(false);
    const [profile] = parsed.value;
    expect(profile.data.global_gain).toBe(12);
    expect(profile.data.filters[0].freq).toBe(20_000);
    expect(profile.data.filters[0].gain).toBe(-12);
    expect(profile.data.filters[0].q).toBe(20);
    expect(profile.data.filters[1].freq).toBe(20);
    expect(profile.data.filters[1].gain).toBe(12);
    expect(profile.data.filters[1].q).toBeCloseTo(0.1);
  });

  it("accepts names Rust's is_alphanumeric accepts (Other_Alphabetic marks)", async () => {
    // Devanagari vowel signs are Alphabetic but not \p{L}; Rust's
    // char::is_alphanumeric accepts them, so the web validator must too.
    const name = "का profile";
    await invoke("save_profile", { name, peq: { filters: [], global_gain: 0 } });

    const stored = JSON.parse(localStorageValues.get("glacier-eq-profiles") ?? "[]");
    expect(stored.map((entry: { name: string }) => entry.name)).toEqual([name]);
  });

  it("keeps the stored name on a case-only save, like ProfileStore::path", async () => {
    await invoke("save_profile", { name: "Daily EQ", peq: { filters: [], global_gain: -1 } });
    await invoke("save_profile", { name: "daily eq", peq: { filters: [], global_gain: -2 } });

    const stored = JSON.parse(localStorageValues.get("glacier-eq-profiles") ?? "[]");
    expect(stored).toHaveLength(1);
    // The data is replaced, but the stored identity keeps its original casing
    // — the desktop store rewrites the existing file rather than renaming it.
    expect(stored[0].name).toBe("Daily EQ");
    expect(stored[0].data.global_gain).toBe(-2);
  });
});

describe("WebHID device matching", () => {
  it("prefers an exact PID match over a vendor fallback regardless of order", () => {
    const fallback: SupportedDeviceInfo = {
      ...profile,
      name: "Vendor Generic",
      product_id: null,
    };
    const exact: SupportedDeviceInfo = { ...profile, name: "Exact Model" };

    // Fallback listed first must not shadow the exact profile,
    // mirroring get_supported_device in glacier-core.
    expect(matchSupportedWebHidDevice({ vendorId: 0x1234, productId: 0x5678 }, [fallback, exact]))
      .toBe(exact);
    expect(matchSupportedWebHidDevice({ vendorId: 0x1234, productId: 0x5678 }, [exact, fallback]))
      .toBe(exact);
  });

  it("falls back to a vendor-level profile when no exact PID matches", () => {
    const fallback: SupportedDeviceInfo = {
      ...profile,
      name: "Vendor Generic",
      product_id: null,
    };

    expect(matchSupportedWebHidDevice({ vendorId: 0x1234, productId: 0xabcd }, [fallback]))
      .toBe(fallback);
    expect(matchSupportedWebHidDevice({ vendorId: 0x1234, productId: 0xabcd }, [])).toBeUndefined();
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

describe("openUrl", () => {
  it("opens the URL without handing the opener to the new tab", async () => {
    const originalWindow = globalThis.window;
    const opened = { opener: globalThis } as unknown as Window;
    const openMock = vi.fn(() => opened);
    (globalThis as unknown as { window?: unknown }).window = { open: openMock };

    await openUrl("https://github.com/Bukutsu/glacier-eq");

    // No windowFeatures: noopener/noreferrer in features force a null
    // return even on success, which made popup-blocking undetectable.
    // The opener handle is severed below instead.
    expect(openMock).toHaveBeenCalledWith(
      "https://github.com/Bukutsu/glacier-eq",
      "_blank",
    );
    expect(opened.opener).toBeNull();
    globalThis.window = originalWindow;
  });

  it("rejects when the browser blocks the popup instead of resolving as success", async () => {
    const originalWindow = globalThis.window;
    const openMock = vi.fn(() => null);
    (globalThis as unknown as { window?: unknown }).window = { open: openMock };

    // The old implementation ignored the return value: a blocked popup
    // resolved the promise and the click vanished without a trace.
    await expect(openUrl("https://example.com")).rejects.toThrow(
      /blocked opening this link/,
    );
    globalThis.window = originalWindow;
  });
});

describe("storage quarantine", () => {
  it("signals when malformed saved settings are quarantined and where the backup went", async () => {
    localStorageValues.set("glacier-eq-settings", "{not json at all");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await invoke("get_settings");

    // The old path replaced the value with total silence — the only trace
    // was a -malformed- key nobody knows to look for.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("backed up"));
    const backup = [...localStorageValues.entries()].find(([key]) =>
      key.startsWith("glacier-eq-settings-malformed-"),
    );
    expect(backup?.[1]).toBe("{not json at all");
    // The live key holds the safe fallback now, not the garbage.
    expect(() => JSON.parse(localStorageValues.get("glacier-eq-settings") ?? "")).not.toThrow();
    // The diagnostic the fix emits must survive the parser contract:
    // source "Storage" is in the DiagnosticEvent union, so both the live
    // event consumer and get_diagnostics history keep working afterwards.
    const history = await invoke<unknown[]>("get_diagnostics");
    const events = parseDiagnosticHistory(history);
    expect(
      events.some(
        (event) => event.source === "Storage" && event.message.includes("backed up"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("signals when the quarantine backup itself cannot be written", async () => {
    localStorageValues.set("glacier-eq-profiles", "{not json at all");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await invoke("list_profiles");

    // Without this signal the malformed original silently stays behind and
    // every later load re-quarantines and fails the same way, with defaults
    // mysteriously winning over "saved" data.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("could not be replaced"));
    // The failed backup lost nothing: the original is still there.
    expect(localStorageValues.get("glacier-eq-profiles")).toBe("{not json at all");
    warnSpy.mockRestore();
  });
});

describe("add_diagnostic_event command boundary", () => {
  it("rejects out-of-union level or source like desktop's serde boundary", async () => {
    const before = (await invoke<unknown[]>("get_diagnostics")).length;

    // An invalid event reaching the store would later make
    // parseDiagnosticHistory throw and blank the whole history view.
    await expect(
      invoke("add_diagnostic_event", { level: "Info", source: "Bogus", message: "x" }),
    ).rejects.toThrow("Invalid diagnostic event payload");
    await expect(
      invoke("add_diagnostic_event", { level: "Severe", source: "UI", message: "x" }),
    ).rejects.toThrow("Invalid diagnostic event payload");
    await expect(
      invoke("add_diagnostic_event", { level: "Info", source: "UI", message: 42 }),
    ).rejects.toThrow("Invalid diagnostic event payload");

    expect((await invoke<unknown[]>("get_diagnostics")).length).toBe(before);

    // P4 round-5 probe: a rejected event must not poison the chain — the
    // very next history read still resolves.
    await expect(invoke("get_diagnostics")).resolves.toBeDefined();
  });

  it("sanitizes messages like desktop's sanitize_message (flatten + 2000 cap)", async () => {
    await invoke("add_diagnostic_event", {
      level: "Error",
      source: "UI",
      message: "Render crash: boom\nStack: at <Panel>",
    });
    await invoke("add_diagnostic_event", {
      level: "Info",
      source: "UI",
      message: "y".repeat(2_500),
    });

    const history = await invoke<unknown[]>("get_diagnostics");
    const parsed = parseDiagnosticHistory(history);
    const flattened = parsed[parsed.length - 2];
    const capped = parsed[parsed.length - 1];
    // Desktop flattens \r and \n to spaces: the exporter's
    // "timestamp [LEVEL] [SOURCE] message" lines cannot be forged.
    expect(flattened.message).toBe("Render crash: boom Stack: at <Panel>");
    expect(flattened.message).not.toMatch(/[\r\n]/);
    expect(capped.message).toHaveLength(2_000);
    expect(capped.message).not.toMatch(/[\r\n]/);
  });

  it("accepts a valid event and keeps the whole history parseable", async () => {
    const before = (await invoke<unknown[]>("get_diagnostics")).length;

    await invoke("add_diagnostic_event", {
      level: "Warn",
      source: "Storage",
      message: "boundary-ok",
    });

    const history = await invoke<unknown[]>("get_diagnostics");
    expect(history.length).toBe(before + 1);
    // Nothing invalid entered the store: the history the ToolsPanel loads
    // must parse end-to-end.
    expect(parseDiagnosticHistory(history)).toHaveLength(history.length);
  });
});

describe("save_text_file command boundary", () => {
  it("rejects non-string content like the desktop command", async () => {
    // The desktop path runs content through String serde + tauri.ts:48-50;
    // without this check new Blob([42]) downloads a coerced "42" file.
    await expect(
      invoke("save_text_file", { path: "export/profile.txt", content: 42 }),
    ).rejects.toThrow("Invalid text export content");
    await expect(
      invoke("save_text_file", { path: "export/profile.txt", content: { a: 1 } }),
    ).rejects.toThrow("Invalid text export content");
    await expect(
      invoke("save_text_file", { path: "export/profile.txt", content: ["x"] }),
    ).rejects.toThrow("Invalid text export content");
  });
});

describe("wasm outage isolation", () => {
  it("keeps pure-JS diagnostics commands working when the wasm chunk fails to load", async () => {
    wasmGate.failure = new Error("Failed to fetch dynamically imported module");
    try {
      // wasm-dependent commands fail loudly while the gate is down...
      await expect(invoke("list_supported_devices")).rejects.toThrow(
        "Failed to fetch",
      );
      // ...but the panel's history load and clear are pure JS and must
      // serve the view the store actually holds. (get_diagnostic_context is
      // in the same set but reads __APP_VERSION__, a build-time define that
      // vitest does not inject — it cannot run under this harness.)
      expect(Array.isArray(await invoke("get_diagnostics"))).toBe(true);
      await expect(invoke("clear_diagnostics")).resolves.toBeNull();
    } finally {
      wasmGate.failure = null;
    }
  });
});
