/// <reference types="w3c-web-hid" />
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { isTauri } from "./platform";
import type { AppSettings, Filter, PEQData, SupportedDeviceInfo } from "../types";
import initWasm, {
  list_supported_devices,
  parse_autoeq,
  peq_to_autoeq,
  match_profile_name,
  run_autoeq,
  build_init_packets,
  build_read_filter_request,
  matches_filter_response,
  parse_filter_response,
  build_read_global_gain_request,
  matches_global_gain_response,
  parse_global_gain_response,
  build_write_filter_packets,
  build_write_global_gain_packets,
  build_commit_packets,
  build_ram_apply_packets,
  build_filter_mode_write_packet,
  build_amp_mode_write_packet,
  build_gain_mode_write_packet,
  build_balance_write_packets,
  build_mic_volume_write_packet,
  build_factory_reset_packet,
  build_flash_eq_packet,
  get_write_timing
} from "../wasm_pkg/glacier_core";

// ─── WASM Initialization ──────────────────────────────────────────────────────

let wasmInitPromise: Promise<unknown> | null = null;
async function ensureWasm() {
  wasmInitPromise ??= initWasm();
  await wasmInitPromise;
}

// ─── Browser Event Bus (Tauri Event Mimic) ───────────────────────────────────

const eventListeners: { [event: string]: ((event: { payload: any }) => void)[] } = {};

export async function listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  if (isTauri()) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return tauriListen(event, callback);
  }
  if (!eventListeners[event]) {
    eventListeners[event] = [];
  }
  eventListeners[event].push(callback);
  return () => {
    eventListeners[event] = eventListeners[event].filter((cb) => cb !== callback);
  };
}

export async function emit(event: string, payload?: any): Promise<void> {
  if (isTauri()) {
    const { emit: tauriEmit } = await import("@tauri-apps/api/event");
    return tauriEmit(event, payload);
  }
  emitEvent(event, payload);
}

function emitEvent(event: string, payload: any) {
  const listeners = eventListeners[event];
  if (listeners) {
    listeners.forEach((cb) => cb({ payload }));
  }
}

let webHidDisconnectListenerInstalled = false;

function ensureWebHid(): HID {
  const hid = navigator.hid;
  if (!hid) {
    throw new Error("WebHID is not available. Use a Chromium-based browser over HTTPS or localhost.");
  }
  if (!webHidDisconnectListenerInstalled) {
    hid.addEventListener("disconnect", (event: any) => {
      markWebHidDisconnected(event.device);
    });
    webHidDisconnectListenerInstalled = true;
  }
  return hid;
}

function matchSupportedWebHidDevice(
  device: Pick<HIDDevice, "vendorId" | "productId">,
  supportedDevices: SupportedDeviceInfo[],
): SupportedDeviceInfo | undefined {
  return supportedDevices.find((supported) =>
    supported.vendor_id === device.vendorId &&
    (supported.product_id == null || supported.product_id === device.productId),
  );
}

// ─── WebHID Active State ──────────────────────────────────────────────────────

let activeDevice: HIDDevice | null = null;
let activeProfile: any = null; // Contains metadata & caps
const webHidIds = new WeakMap<HIDDevice, number>();
let nextWebHidId = 1;

function webHidPath(device: HIDDevice): string {
  let id = webHidIds.get(device);
  if (!id) {
    id = nextWebHidId++;
    webHidIds.set(device, id);
  }
  return `webhid:${device.vendorId}:${device.productId}:${id}`;
}

// Memory Diagnostic Store for Web mode
const MAX_DIAGNOSTICS = 500;
let diagnosticsStore: { level: string; source: string; message: string; timestamp: string }[] = [];

function addDiagnostic(level: string, source: string, message: string) {
  const event = {
    level,
    source,
    message,
    timestamp: new Date().toISOString(),
  };
  diagnosticsStore.push(event);
  if (diagnosticsStore.length > MAX_DIAGNOSTICS) {
    diagnosticsStore.shift();
  }
  emitEvent("diagnostic-event", event);
}

// HID Read Queue
let reportQueue: Uint8Array[] = [];
let reportResolvers: ((report: Uint8Array) => void)[] = [];

const inputReportListeners = new Map<HIDDevice, (event: any) => void>();

function detachHidEventListeners(device?: HIDDevice | null) {
  if (!device) return;
  const listener = inputReportListeners.get(device);
  if (listener) {
    device.removeEventListener("inputreport", listener);
    inputReportListeners.delete(device);
  }
}

function markWebHidDisconnected(device?: HIDDevice) {
  const target = device || activeDevice;
  if (!activeDevice || (device && activeDevice !== device)) return;
  detachHidEventListeners(target);
  const name = activeProfile?.name || activeDevice.productName || "WebHID device";
  activeDevice = null;
  activeProfile = null;
  reportQueue = [];
  while (reportResolvers.length > 0) {
    const resolver = reportResolvers.shift();
    if (resolver) resolver(new Uint8Array(0));
  }
  emitEvent("device-disconnected", name);
}

function setupHidEventListeners(device: HIDDevice) {
  detachHidEventListeners(device);

  const listener = (event: any) => {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const framed = new Uint8Array(bytes.length + 1);
    framed[0] = event.reportId;
    framed.set(bytes, 1);
    
    if (reportResolvers.length > 0) {
      const resolver = reportResolvers.shift();
      if (resolver) resolver(framed);
    } else {
      if (reportQueue.length >= 50) {
        reportQueue.shift();
      }
      reportQueue.push(framed);
    }
  };

  inputReportListeners.set(device, listener);
  device.addEventListener("inputreport", listener);
}

async function sendReport(packet: number[] | Uint8Array): Promise<void> {
  const device = activeDevice;
  if (!device) throw new Error("No device connected");
  try {
    await device.sendReport(packet[0], new Uint8Array(packet.slice(1)));
  } catch (error) {
    markWebHidDisconnected(device);
    throw error;
  }
}

async function readReport(timeoutMs: number): Promise<Uint8Array> {
  if (reportQueue.length > 0) {
    return reportQueue.shift()!;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reportResolvers = reportResolvers.filter((r) => r !== resolver);
      reject(new Error("Timeout reading from device"));
    }, timeoutMs);
    
    const resolver = (report: Uint8Array) => {
      clearTimeout(timer);
      resolve(report);
    };
    reportResolvers.push(resolver);
  });
}

async function readMatchingReport(
  timeoutMs: number,
  matches: (report: Uint8Array) => boolean,
): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const report = await readReport(timeoutMs);
      if (matches(report)) return report;
    } catch {
      // Ignore timeout or mismatch and continue next attempt
    }
  }
  return null;
}

async function sendPackets(packets: (number[] | Uint8Array)[], delayMs = 0): Promise<void> {
  for (const packet of packets) {
    await sendReport(packet);
    if (delayMs > 0) await sleep(delayMs);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadJson<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

const CMD_FILTER_MODE = 17;
const CMD_AMP_MODE = 29;
const CMD_GAIN_MODE = 25;
const CMD_MIC_VOLUME = 2;

function walkplayPacket(payload: number[]): number[] {
  return [0x4b, ...payload];
}

function supportsWalkplayUtilities(): boolean {
  return activeProfile?.protocol === "Walkplay";
}

function connectedProfile(): any {
  if (!activeProfile) throw new Error("No device connected");
  return activeProfile;
}

function unsupportedUtilityState() {
  return {
    supported: false,
    filter_mode: "FAST-LL",
    amp_mode_class_ab: false,
    high_gain_mode: false,
    mic_volume_db: 0,
    channel_balance: 0,
  };
}

async function writeAndFlash(packet: number[] | Uint8Array) {
  await sendReport(packet);
  await sleep(50);
  await sendReport(build_flash_eq_packet());
}

async function readWalkplayUtility(cmd: number): Promise<Uint8Array> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      await sendReport(walkplayPacket([0x80, cmd, 0x00]));
      await sleep(25);
      const report = await readMatchingReport(100, (data) =>
        data.length >= 5 && data[0] === 0x4b && data[1] === 0x80 && data[2] === cmd
      );
      if (report) return report;
    } catch {
      // Retry
    }
    await sleep(40);
  }
  throw new Error(`Timeout reading device utility ${cmd}`);
}

async function readWalkplayBalance(channel: number): Promise<number> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      await sendReport(walkplayPacket([0x80, 0x16, 0x01, channel]));
      await sleep(25);
      const report = await readMatchingReport(100, (data) =>
        data.length >= 7 && data[0] === 0x4b && data[1] === 0x80 && data[2] === 0x16 && data[4] === channel
      );
      if (report) return report[6];
    } catch {
      // Retry
    }
    await sleep(40);
  }
  throw new Error(`Timeout reading channel ${channel} balance`);
}

function disabledFilter(index: number): Filter {
  return {
    index,
    enabled: false,
    filter_type: "Peak",
    freq: 1000,
    gain: 0,
    q: 1,
  };
}

export function constrainPeqToBandCount(peq: PEQData, numBands: number): PEQData {
  return {
    global_gain: peq.global_gain,
    filters: Array.from({ length: numBands }, (_, index) => peq.filters[index] ?? disabledFilter(index)),
  };
}

function resetPeq(numBands: number): PEQData {
  return {
    global_gain: 0,
    filters: Array.from({ length: numBands }, (_, index) => disabledFilter(index)),
  };
}

async function writeEqPayload(protocol: string, peq: PEQData, initMessage: string) {
  const timing = get_write_timing(protocol);

  emitEvent("operation-progress", { message: initMessage, percentage: 10 });
  await sendPackets(build_init_packets(protocol));
  await sleep(50);

  const total = peq.filters.length;
  for (let i = 0; i < total; i++) {
    emitEvent("operation-progress", {
      message: `Writing band ${i + 1}/${total}...`,
      percentage: 15.0 + (i / total) * 60.0,
    });

    await sendPackets(build_write_filter_packets(
      protocol,
      i,
      peq.filters[i],
      activeProfile.dsp_sample_rate || 96000.0,
      peq.global_gain,
    ));
    await sleep(timing.per_filter_ms || 80);
  }

  emitEvent("operation-progress", { message: "Writing preamp...", percentage: 75 });
  await sleep(timing.batch_ms || 100);
  await sendPackets(build_write_global_gain_packets(protocol, peq.global_gain));
  await sleep(timing.global_gain_ms || 50);
}

function parseWalkplayFirmwareVersion(data: Uint8Array): string | null {
  const bytes = Array.from(data.slice(3, 10));
  let version = "";
  for (const byte of bytes) {
    if (byte < 0x21 || byte > 0x7e) break;
    version += String.fromCharCode(byte);
  }
  return version || null;
}

// ─── Tauri Command Mock Routing ──────────────────────────────────────────────

let webHidOperation = Promise.resolve();

function serializeWebHid<T>(operation: () => Promise<T>): Promise<T> {
  const result = webHidOperation.then(operation, operation);
  webHidOperation = result.then(() => undefined, () => undefined);
  return result;
}

export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  return serializeWebHid(() => invokeWeb<T>(cmd, args));
}

async function invokeWeb<T = any>(cmd: string, args?: any): Promise<T> {
  // Ensure WASM is loaded first
  await ensureWasm();

  // Log WebRPC calls to local diagnostics. Args are truncated: measurement and
  // AutoEQ payloads serialize to hundreds of KB per call.
  if (cmd !== "get_diagnostics" && cmd !== "add_diagnostic_event") {
    const serialized = JSON.stringify(args || {});
    const summary = serialized.length > 200 ? `${serialized.slice(0, 200)}…(${serialized.length} bytes)` : serialized;
    addDiagnostic("Info", "UI", `WebRPC invoke("${cmd}", ${summary})`);
  }

  switch (cmd) {
    // ─── Settings ───────────────────────────────────────────────────────────
    case "get_settings": {
      return loadJson("glacier-eq-settings", {}) as T;
    }
    case "save_settings": {
      saveJson("glacier-eq-settings", args.settings);
      return null as T;
    }

    // ─── Profiles / Presets ─────────────────────────────────────────────────
    case "list_profiles": {
      return loadJson("glacier-eq-profiles", []) as T;
    }
    case "save_profile": {
      // Mirror ProfileStore::save's envelope so both platforms enforce
      // identical limits instead of trusting the IPC payload verbatim.
      const peq = args.peq;
      if (!peq || !Array.isArray(peq.filters) || peq.filters.length > 32) {
        throw new Error("Profile exceeds maximum filter count (32)");
      }
      const text = peq_to_autoeq(peq);
      if (text.length > 1_048_576) {
        throw new Error("Profile exceeds maximum size (1 MiB)");
      }
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      const normalized = (parse_autoeq(text, vid, pid) as any).peq;
      const profiles = loadJson<any[]>("glacier-eq-profiles", []);
      const normalizedName = String(args.name).toLocaleLowerCase();
      const idx = profiles.findIndex((p: any) => String(p.name).toLocaleLowerCase() === normalizedName);
      const newProfile = {
        name: args.name,
        data: normalized,
        modified: Math.floor(Date.now() / 1000),
      };
      if (idx >= 0) {
        profiles[idx] = newProfile;
      } else {
        profiles.push(newProfile);
      }
      saveJson("glacier-eq-profiles", profiles);
      return null as T;
    }
    case "delete_profile": {
      const profiles = loadJson<any[]>("glacier-eq-profiles", []);
      saveJson("glacier-eq-profiles", profiles.filter((p: any) => p.name !== args.name));
      return null as T;
    }
    case "open_profiles_dir": {
      alert("Profiles are stored in browser localStorage. You can export/import them using the Profile tools.");
      return null as T;
    }

    // ─── AutoEQ & Utilities ──────────────────────────────────────────────────
    case "list_supported_devices": {
      return list_supported_devices() as T;
    }
    case "parse_autoeq": {
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      return parse_autoeq(args.text, vid, pid) as T;
    }
    case "peq_to_autoeq": {
      return peq_to_autoeq(args.peq) as T;
    }
    case "match_profile_name": {
      const profiles = loadJson<any[]>("glacier-eq-profiles", []);
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      return match_profile_name(args.peq, profiles, vid, pid) as T;
    }
    case "run_autoeq": {
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      const measurementPoints = args.measurement_points ?? args.measurementPoints;
      const targetPoints = args.target_points ?? args.targetPoints;
      return run_autoeq(
        measurementPoints,
        targetPoints,
        args.n_bands ?? args.nBands,
        args.steps,
        args.smooth_type ?? args.smoothType,
        args.fs,
        vid,
        pid
      ) as T;
    }
    case "save_text_file": {
      const filename = args.path.split("/").pop() || "profile.txt";
      const blob = new Blob([args.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // Revoking synchronously can cancel the download before the browser
      // fetches the blob URL; give it time to complete.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return null as T;
    }

    // ─── Diagnostics ────────────────────────────────────────────────────────
    case "add_diagnostic_event": {
      addDiagnostic(args.level, args.source, args.message);
      return null as T;
    }
    case "get_diagnostics": {
      return diagnosticsStore as T;
    }
    case "clear_diagnostics": {
      diagnosticsStore = [];
      return null as T;
    }

    // ─── Device Connection / HID ──────────────────────────────────────────────
    case "list_devices": {
      const devices = await ensureWebHid().getDevices();
      const supported = list_supported_devices() as SupportedDeviceInfo[];
      return devices.flatMap((dev: any) => {
        const profile = matchSupportedWebHidDevice(dev, supported);
        if (!profile) return [];
        return [{
          ...profile,
          vendor_id: dev.vendorId,
          product_id: dev.productId,
          path: webHidPath(dev),
          manufacturer: dev.manufacturerName || null,
          product_string: dev.productName || null,
          profile_name: profile.name,
        }];
      }) as T;
    }
    case "connect_device": {
      const devices = await ensureWebHid().getDevices();
      const target = devices.find((dev: any) => webHidPath(dev) === args.path);
      if (!target || !matchSupportedWebHidDevice(target, list_supported_devices() as SupportedDeviceInfo[])) {
        throw new Error("Unsupported or unavailable device. Please click 'Scan' to authorize a supported DAC.");
      }

      if (activeDevice && activeDevice !== target) {
        detachHidEventListeners(activeDevice);
        try { await activeDevice.close(); } catch {}
        activeDevice = null;
      }

      if (!target.opened) {
        await target.open();
      }
      activeDevice = target;
      reportQueue = [];
      reportResolvers = [];
      setupHidEventListeners(target);

      const supported = list_supported_devices() as SupportedDeviceInfo[];
      const found = matchSupportedWebHidDevice(target, supported);
      activeProfile = {
        ...found!,
        vendor_id: target.vendorId,
        product_id: target.productId,
      };

      return null as T;
    }
    case "disconnect_device": {
      if (activeDevice) {
        detachHidEventListeners(activeDevice);
        try {
          await activeDevice.close();
        } catch {}
        activeDevice = null;
        activeProfile = null;
        reportQueue = [];
        while (reportResolvers.length > 0) {
          const resolver = reportResolvers.shift();
          if (resolver) resolver(new Uint8Array(0));
        }
      }
      return null as T;
    }
    case "get_firmware_version": {
      if (!activeDevice || activeProfile?.protocol !== "Walkplay") return null as T;

      await sendReport([0x4b, 0x80, 0x0c, 0x00]);
      const report = await readMatchingReport(500, (data) =>
        data.length >= 10 && data[0] === 0x4b && data[1] === 0x80 && data[2] === 0x0c
      );
      if (!report) return null as T;
      return parseWalkplayFirmwareVersion(report.slice(1)) as T;
    }
    case "get_eq_state": {
      const profile = connectedProfile();
      const protocol = profile.protocol;
      const numBands = profile.num_bands;
      reportQueue = [];
      await sendPackets(build_init_packets(protocol));
      await sleep(50);

      // 1. read global gain
      const req = build_read_global_gain_request(protocol);
      await sendReport(req);
      
      const globalResponse = await readMatchingReport(200, (data) => matches_global_gain_response(protocol, data));
      if (!globalResponse) throw new Error("Global gain read timeout");
      const global_gain = parse_global_gain_response(protocol, globalResponse);

      // 2. read filters
      const filters = [];
      const timing = get_write_timing(protocol);

      await sleep(timing.post_gain_read_ms || 0);

      for (let i = 0; i < numBands; i++) {
        emitEvent("operation-progress", {
          message: `Reading band ${i + 1}/${numBands}...`,
          percentage: Math.round(((i + 1) / numBands) * 90),
        });

        const nonce = i;
        const filterReq = build_read_filter_request(protocol, i, nonce);
        let filter: any = null;

        for (let retry = 0; retry < 3; retry++) {
          try {
            await sendReport(filterReq);
            const res = await readMatchingReport(250, (data) => matches_filter_response(protocol, data, i, nonce));
            if (res) {
              filter = parse_filter_response(protocol, res);
              break;
            }
          } catch (e) {
            console.warn(`Retry ${retry + 1} reading band ${i} failed:`, e);
          }
        }

        if (!filter) {
          throw new Error(`Failed to read band ${i + 1}`);
        }
        filters.push(filter);

        await sleep(timing.flood_delay_ms || 5);
      }

      return {
        filters,
        global_gain,
      } as T;
    }
    case "set_eq_state": {
      const profile = connectedProfile();
      const protocol = profile.protocol;
      const timing = get_write_timing(protocol);
      const peq = constrainPeqToBandCount(args.peq, profile.num_bands);
      await writeEqPayload(protocol, peq, "Initializing push connection...");

      // 4. commit changes
      emitEvent("operation-progress", { message: "Committing changes to device...", percentage: 80 });
      for (const pkt of build_commit_packets(protocol)) {
        await sendReport(pkt);
        await sleep(timing.commit_step_ms || 100);
      }

      if (!loadJson<Partial<AppSettings>>("glacier-eq-settings", {}).skip_push_verification) {
        const actual = await invokeWeb<PEQData>("get_eq_state");
        if (Math.abs(actual.global_gain - peq.global_gain) > 0.2 || actual.filters.some((filter, index) => {
          const expected = peq.filters[index];
          if (!expected) return true;
          if (!expected.enabled) return Math.abs(filter.gain) > 0.2;
          return Math.abs(filter.gain - expected.gain) > 0.2 || Math.abs(filter.freq - expected.freq) > 1 || Math.abs(filter.q - expected.q) > 0.1;
        })) {
          throw new Error("Device verification failed after write");
        }
      }
      emitEvent("operation-progress", { message: "Write complete", percentage: 100 });
      return null as T;
    }
    case "apply_eq_state": {
      const profile = connectedProfile();
      const protocol = profile.protocol;
      const timing = get_write_timing(protocol);
      const peq = constrainPeqToBandCount(args.peq, profile.num_bands);
      await writeEqPayload(protocol, peq, "Initializing apply connection...");

      // 4. apply to RAM
      emitEvent("operation-progress", { message: "Applying to RAM...", percentage: 85 });
      for (const pkt of build_ram_apply_packets(protocol)) {
        await sendReport(pkt);
        await sleep(timing.commit_step_ms || 100);
      }

      emitEvent("operation-progress", { message: "Apply complete", percentage: 100 });
      return null as T;
    }

    // ─── Walkplay Hardware controls ──────────────────────────────────────────
    case "get_dac_utility_state": {
      if (!activeDevice || !supportsWalkplayUtilities()) return unsupportedUtilityState() as T;

      const filter = await readWalkplayUtility(CMD_FILTER_MODE);
      await sleep(25);
      const amp = await readWalkplayUtility(CMD_AMP_MODE);
      await sleep(25);
      const gain = await readWalkplayUtility(CMD_GAIN_MODE);
      await sleep(25);
      const mic = await readWalkplayUtility(CMD_MIC_VOLUME);
      await sleep(25);
      const leftRaw = await readWalkplayBalance(0);
      await sleep(25);
      const rightRaw = await readWalkplayBalance(1);
      const left = leftRaw > 0 ? 256 - leftRaw : 0;
      const right = rightRaw > 0 ? 256 - rightRaw : 0;
      const filterMode = {
        1: "FAST-LL",
        2: "FAST-PC",
        3: "Slow-LL",
        4: "Slow-PC",
        5: "NON-OS",
      }[filter[4]];
      if (!filterMode || amp[4] === undefined || gain[4] === undefined || mic[5] === undefined) {
        throw new Error("Device utility response was incomplete");
      }

      return {
        supported: true,
        filter_mode: filterMode,
        amp_mode_class_ab: amp[4] === 1,
        high_gain_mode: gain[4] === 1,
        mic_volume_db: mic[5] << 24 >> 24,
        channel_balance: left > 0 ? left : right > 0 ? -right : 0,
      } as T;
    }
    case "set_dac_filter_mode": {
      await writeAndFlash(build_filter_mode_write_packet(args.mode));
      return null as T;
    }
    case "set_dac_work_mode": {
      await writeAndFlash(build_amp_mode_write_packet(args.isClassAb));
      return null as T;
    }
    case "set_dac_output_gain": {
      await writeAndFlash(build_gain_mode_write_packet(args.isHighGain));
      return null as T;
    }
    case "set_dac_balance": {
      const packets = build_balance_write_packets(args.balance);
      await sendPackets(packets, 20);
      const flash = build_flash_eq_packet();
      await sendReport(flash);
      return null as T;
    }
    case "set_mic_volume": {
      await writeAndFlash(build_mic_volume_write_packet(args.volumeDb));
      return null as T;
    }
    case "reset_device_eq": {
      const peq = resetPeq(activeProfile?.num_bands ?? 10);
      await invokeWeb("set_eq_state", { peq });
      return null as T;
    }
    case "reset_device_controls": {
      await invokeWeb("set_dac_filter_mode", { mode: "FAST-LL" });
      await invokeWeb("set_dac_work_mode", { isClassAb: false });
      await invokeWeb("set_dac_output_gain", { isHighGain: false });
      await invokeWeb("set_mic_volume", { volumeDb: 0 });
      await invokeWeb("set_dac_balance", { balance: 0 });
      return invokeWeb<T>("get_dac_utility_state");
    }
    case "execute_factory_reset": {
      await writeAndFlash(build_factory_reset_packet());
      return null as T;
    }

    default:
      console.warn(`Unhandled mock command: ${cmd}`);
      return null as T;
  }
}

// Helper to trigger browser WebHID picker
export async function requestWebHidDevice(): Promise<void> {
  await ensureWasm();
  const supported = list_supported_devices();
  const filters = supported.map((s: any) => ({
    vendorId: s.vendor_id,
    productId: s.product_id || undefined,
  }));
  
  const selected = await ensureWebHid().requestDevice({ filters });
  if (selected.length > 0) {
    console.log("WebHID device permitted by user:", selected[0]);
  }
}

export async function readText(): Promise<string> {
  if (isTauri()) {
    const { readText: tauriReadText } = await import("@tauri-apps/plugin-clipboard-manager");
    return tauriReadText();
  }
  return navigator.clipboard.readText();
}

export async function writeText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText: tauriWriteText } = await import("@tauri-apps/plugin-clipboard-manager");
    return tauriWriteText(text);
  }
  return navigator.clipboard.writeText(text);
}

export async function save(options?: any): Promise<string | null> {
  if (isTauri()) {
    const { save: tauriSave } = await import("@tauri-apps/plugin-dialog");
    return tauriSave(options);
  }
  return options?.defaultPath || "profile.txt";
}

export async function openFileDialog(options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<{ text: string; name: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open(options);
    if (!path) return null;
    const name = path.split("/").pop()?.split("\\").pop() ?? "untitled";
    const text = await invoke<string>("read_text_file", { path });
    return { text, name };
  }
  // Web fallback: create a hidden file input
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options?.filters) {
      input.accept = options.filters
        .flatMap((f) => f.extensions)
        .map((e) => "." + e)
        .join(",");
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
    };

    const handleWindowFocus = () => {
      // Browsers refocus window when file picker dialog is dismissed
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, 300);
    };

    input.oncancel = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    };

    input.onchange = async () => {
      if (settled) return;
      settled = true;
      const file = input.files?.[0];
      if (file) {
        if (file.size > 1_048_576) {
          cleanup();
          resolve(null);
          return;
        }
        try {
          const text = await file.text();
          cleanup();
          resolve({ text, name: file.name });
        } catch {
          cleanup();
          resolve(null);
        }
      } else {
        cleanup();
        resolve(null);
      }
    };

    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.click();
  });
}
