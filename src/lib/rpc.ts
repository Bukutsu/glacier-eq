/// <reference types="w3c-web-hid" />
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { isTauri } from "./platform";
import initWasm, {
  list_supported_devices,
  parse_autoeq,
  peq_to_autoeq,
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

let wasmInitialized = false;
async function ensureWasm() {
  if (wasmInitialized) return;
  await initWasm();
  wasmInitialized = true;
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

function emitEvent(event: string, payload: any) {
  const listeners = eventListeners[event];
  if (listeners) {
    listeners.forEach((cb) => cb({ payload }));
  }
}

// ─── WebHID Active State ──────────────────────────────────────────────────────

let activeDevice: HIDDevice | null = null;
let activeProfile: any = null; // Contains metadata & caps

// Memory Diagnostic Store for Web mode
let diagnosticsStore: { level: string; source: string; message: string; timestamp: string }[] = [];

function addDiagnostic(level: string, source: string, message: string) {
  const event = {
    level,
    source,
    message,
    timestamp: new Date().toISOString(),
  };
  diagnosticsStore.push(event);
  emitEvent("diagnostic-event", event);
}

// HID Read Queue
let reportQueue: Uint8Array[] = [];
let reportResolvers: ((report: Uint8Array) => void)[] = [];

function setupHidEventListeners(device: HIDDevice) {
  device.addEventListener("inputreport", (event: any) => {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const framed = new Uint8Array(bytes.length + 1);
    framed[0] = event.reportId;
    framed.set(bytes, 1);
    
    if (reportResolvers.length > 0) {
      const resolver = reportResolvers.shift();
      if (resolver) resolver(framed);
    } else {
      reportQueue.push(framed);
    }
  });
}

async function sendReport(packet: number[] | Uint8Array): Promise<void> {
  await activeDevice!.sendReport(packet[0], new Uint8Array(packet.slice(1)));
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
    const report = await readReport(timeoutMs);
    if (matches(report)) return report;
  }
  return null;
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

export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }

  // Ensure WASM is loaded first
  await ensureWasm();

  // Log WebRPC calls to local diagnostics
  if (cmd !== "get_diagnostics" && cmd !== "add_diagnostic_event") {
    addDiagnostic("Info", "UI", `WebRPC invoke("${cmd}", ${JSON.stringify(args || {})})`);
  }

  switch (cmd) {
    // ─── Settings ───────────────────────────────────────────────────────────
    case "get_settings": {
      const settingsStr = localStorage.getItem("glacier-eq-settings");
      return (settingsStr ? JSON.parse(settingsStr) : {}) as T;
    }
    case "save_settings": {
      localStorage.setItem("glacier-eq-settings", JSON.stringify(args.settings));
      return null as T;
    }

    // ─── Profiles / Presets ─────────────────────────────────────────────────
    case "list_profiles": {
      const profilesStr = localStorage.getItem("glacier-eq-profiles");
      return (profilesStr ? JSON.parse(profilesStr) : []) as T;
    }
    case "save_profile": {
      const profilesStr = localStorage.getItem("glacier-eq-profiles");
      const profiles = profilesStr ? JSON.parse(profilesStr) : [];
      const idx = profiles.findIndex((p: any) => p.name === args.name);
      const newProfile = {
        name: args.name,
        data: args.peq,
        modified: new Date().toLocaleDateString(),
      };
      if (idx >= 0) {
        profiles[idx] = newProfile;
      } else {
        profiles.push(newProfile);
      }
      localStorage.setItem("glacier-eq-profiles", JSON.stringify(profiles));
      return null as T;
    }
    case "delete_profile": {
      const profilesStr = localStorage.getItem("glacier-eq-profiles");
      if (profilesStr) {
        const profiles = JSON.parse(profilesStr);
        const filtered = profiles.filter((p: any) => p.name !== args.name);
        localStorage.setItem("glacier-eq-profiles", JSON.stringify(filtered));
      }
      return null as T;
    }
    case "open_profiles_dir": {
      alert("Profiles are stored in browser localStorage. You can export/import them using the preset tools.");
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
      URL.revokeObjectURL(url);
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
      const devices = await navigator.hid.getDevices();
      const supported = list_supported_devices();
      return devices.map((dev: any) => {
        const found = supported.find((s: any) => s.vendor_id === dev.vendorId && (s.product_id === null || s.product_id === undefined || s.product_id === dev.productId));
        return {
          vendor_id: dev.vendorId,
          product_id: dev.productId,
          path: `webhid:${dev.vendorId}:${dev.productId}`,
          manufacturer: dev.manufacturerName || null,
          product_string: dev.productName || null,
          profile_name: found ? found.name : "Supported DAC",
        };
      }) as T;
    }
    case "connect_device": {
      const devices = await navigator.hid.getDevices();
      const target = devices.find((dev: any) => `webhid:${dev.vendorId}:${dev.productId}` === args.path);
      if (!target) {
        throw new Error("Device not found. Please click 'Scan' to authorize.");
      }

      await target.open();
      activeDevice = target;
      reportQueue = [];
      reportResolvers = [];
      setupHidEventListeners(target);

      const supported = list_supported_devices();
      const found = supported.find((s: any) => s.vendor_id === target.vendorId && (s.product_id === null || s.product_id === target.productId));
      activeProfile = found || {
        name: "Supported DAC",
        protocol: "Walkplay",
        vendor_id: target.vendorId,
        product_id: target.productId,
        num_bands: 10,
        supports_ram_apply: false,
      };

      return null as T;
    }
    case "disconnect_device": {
      if (activeDevice) {
        await activeDevice.close();
        activeDevice = null;
        activeProfile = null;
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
      if (!activeDevice || !activeProfile) throw new Error("No device connected");
      
      const protocol = activeProfile.protocol;
      const numBands = activeProfile.num_bands;

      // 1. read global gain
      const req = build_read_global_gain_request(protocol);
      await activeDevice.sendReport(req[0], new Uint8Array(req.slice(1)));
      
      let global_gain = 0.0;
      try {
        const res = await readReport(200);
        if (matches_global_gain_response(protocol, res)) {
          global_gain = parse_global_gain_response(protocol, res);
        }
      } catch (e) {
        console.warn("Global gain read failed, using 0:", e);
      }

      // 2. read filters
      const filters = [];
      const timing = get_write_timing(protocol);

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
            await activeDevice.sendReport(filterReq[0], new Uint8Array(filterReq.slice(1)));
            const res = await readReport(250);
            if (matches_filter_response(protocol, res, i, nonce)) {
              filter = parse_filter_response(protocol, res);
              break;
            }
          } catch (e) {
            console.warn(`Retry ${retry + 1} reading band ${i} failed:`, e);
          }
        }

        if (filter) {
          filters.push(filter);
        } else {
          filters.push({
            index: i,
            enabled: false,
            freq: 1000,
            gain: 0,
            q: 1.0,
            type: "PK",
          });
        }

        await new Promise((resolve) => setTimeout(resolve, timing.flood_delay_ms || 5));
      }

      return {
        filters,
        global_gain,
      } as T;
    }
    case "set_eq_state": {
      if (!activeDevice || !activeProfile) throw new Error("No device connected");
      
      const protocol = activeProfile.protocol;
      const peq = args.peq;
      const timing = get_write_timing(protocol);

      // 1. run init sequence
      emitEvent("operation-progress", { message: "Initializing push connection...", percentage: 10 });
      const initPkts = build_init_packets(protocol);
      for (const pkt of initPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 2. write filters
      const total = peq.filters.length;
      for (let i = 0; i < total; i++) {
        const pct = 15.0 + (i / total) * 60.0;
        emitEvent("operation-progress", {
          message: `Writing band ${i + 1}/${total}...`,
          percentage: pct,
        });

        const filterPkts = build_write_filter_packets(protocol, i, peq.filters[i], activeProfile.dsp_sample_rate || 96000.0);
        for (const pkt of filterPkts) {
          await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
        }
        await new Promise((resolve) => setTimeout(resolve, timing.per_filter_ms || 80));
      }

      // 3. write global gain
      emitEvent("operation-progress", { message: "Writing preamp...", percentage: 75 });
      await new Promise((resolve) => setTimeout(resolve, timing.batch_ms || 100));
      const gainPkts = build_write_global_gain_packets(protocol, peq.global_gain);
      for (const pkt of gainPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      }
      await new Promise((resolve) => setTimeout(resolve, timing.global_gain_ms || 50));

      // 4. commit changes
      emitEvent("operation-progress", { message: "Committing changes to device...", percentage: 80 });
      const commitPkts = build_commit_packets(protocol);
      for (const pkt of commitPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
        await new Promise((resolve) => setTimeout(resolve, timing.commit_step_ms || 100));
      }

      emitEvent("operation-progress", { message: "Push successful", percentage: 100 });
      return null as T;
    }
    case "apply_eq_state": {
      if (!activeDevice || !activeProfile) throw new Error("No device connected");
      
      const protocol = activeProfile.protocol;
      const peq = args.peq;
      const timing = get_write_timing(protocol);

      // 1. run init sequence
      emitEvent("operation-progress", { message: "Initializing apply connection...", percentage: 10 });
      const initPkts = build_init_packets(protocol);
      for (const pkt of initPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 2. write filters
      const total = peq.filters.length;
      for (let i = 0; i < total; i++) {
        const pct = 15.0 + (i / total) * 60.0;
        emitEvent("operation-progress", {
          message: `Writing band ${i + 1}/${total}...`,
          percentage: pct,
        });

        const filterPkts = build_write_filter_packets(protocol, i, peq.filters[i], activeProfile.dsp_sample_rate || 96000.0);
        for (const pkt of filterPkts) {
          await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
        }
        await new Promise((resolve) => setTimeout(resolve, timing.per_filter_ms || 80));
      }

      // 3. write global gain
      emitEvent("operation-progress", { message: "Writing preamp...", percentage: 75 });
      await new Promise((resolve) => setTimeout(resolve, timing.batch_ms || 100));
      const gainPkts = build_write_global_gain_packets(protocol, peq.global_gain);
      for (const pkt of gainPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      }
      await new Promise((resolve) => setTimeout(resolve, timing.global_gain_ms || 50));

      // 4. apply to RAM
      emitEvent("operation-progress", { message: "Applying to RAM...", percentage: 85 });
      const applyPkts = build_ram_apply_packets(protocol);
      for (const pkt of applyPkts) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
        await new Promise((resolve) => setTimeout(resolve, timing.commit_step_ms || 100));
      }

      emitEvent("operation-progress", { message: "Apply successful", percentage: 100 });
      return null as T;
    }

    // ─── Walkplay Hardware controls ──────────────────────────────────────────
    case "get_dac_utility_state": {
      return {
        filter_mode: "FAST-LL",
        amp_mode: "Class-AB",
        gain_mode: "Low",
        balance: 0,
        mic_volume: 0,
      } as T;
    }
    case "set_dac_filter_mode": {
      if (!activeDevice) throw new Error("No device connected");
      const pkt = build_filter_mode_write_packet(args.mode);
      await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const flash = build_flash_eq_packet();
      await activeDevice.sendReport(flash[0], new Uint8Array(flash.slice(1)));
      return null as T;
    }
    case "set_dac_work_mode": {
      if (!activeDevice) throw new Error("No device connected");
      const pkt = build_amp_mode_write_packet(args.isClassAb);
      await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const flash = build_flash_eq_packet();
      await activeDevice.sendReport(flash[0], new Uint8Array(flash.slice(1)));
      return null as T;
    }
    case "set_dac_output_gain": {
      if (!activeDevice) throw new Error("No device connected");
      const pkt = build_gain_mode_write_packet(args.isHighGain);
      await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const flash = build_flash_eq_packet();
      await activeDevice.sendReport(flash[0], new Uint8Array(flash.slice(1)));
      return null as T;
    }
    case "set_dac_balance": {
      if (!activeDevice) throw new Error("No device connected");
      const packets = build_balance_write_packets(args.balance);
      for (const pkt of packets) {
        await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const flash = build_flash_eq_packet();
      await activeDevice.sendReport(flash[0], new Uint8Array(flash.slice(1)));
      return null as T;
    }
    case "set_mic_volume": {
      if (!activeDevice) throw new Error("No device connected");
      const pkt = build_mic_volume_write_packet(args.volumeDb);
      await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const flash = build_flash_eq_packet();
      await activeDevice.sendReport(flash[0], new Uint8Array(flash.slice(1)));
      return null as T;
    }
    case "reset_device_eq": {
      return null as T;
    }
    case "reset_device_controls": {
      if (!activeDevice) throw new Error("No device connected");
      return {
        filter_mode: "FAST-LL",
        amp_mode: "Class-AB",
        gain_mode: "Low",
        balance: 0,
        mic_volume: 0,
      } as T;
    }
    case "execute_factory_reset": {
      if (!activeDevice) throw new Error("No device connected");
      const pkt = build_factory_reset_packet();
      await activeDevice.sendReport(pkt[0], new Uint8Array(pkt.slice(1)));
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
  
  try {
    const selected = await navigator.hid.requestDevice({ filters });
    if (selected.length > 0) {
      console.log("WebHID device permitted by user:", selected[0]);
    }
  } catch (err) {
    console.error("Failed to request WebHID device:", err);
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
