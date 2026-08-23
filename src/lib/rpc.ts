/// <reference types="w3c-web-hid" />
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { isTauri } from "./platform";
import type {
  AppSettings,
  DeviceCapabilities,
  Filter,
  FilterType,
  PEQData,
  Profile,
  SupportedDeviceInfo,
} from "../types";
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
let activeProfile: SupportedDeviceInfo | null = null;
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

export class WebHidReadTimeout extends Error {
  constructor() {
    super("Timeout reading from device");
    this.name = "WebHidReadTimeout";
  }
}

export function shouldRetryWebHidRead(error: unknown, connected: boolean): boolean {
  return connected && error instanceof WebHidReadTimeout;
}

async function readReport(timeoutMs: number): Promise<Uint8Array> {
  if (reportQueue.length > 0) {
    const report = reportQueue.shift();
    if (report) return report;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reportResolvers = reportResolvers.filter((r) => r !== resolver);
      reject(new WebHidReadTimeout());
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
    if (!activeDevice) throw new Error("Device disconnected");
    try {
      const report = await readReport(timeoutMs);
      if (!activeDevice) throw new Error("Device disconnected");
      if (matches(report)) return report;
    } catch (error) {
      if (!shouldRetryWebHidRead(error, activeDevice !== null)) throw error;
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

interface ParsedStorage<T> {
  value: T;
  malformed: boolean;
}

const DEFAULT_WEB_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "auto",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys);
  return Object.keys(value).every((key) => known.has(key));
}

function commandField(args: unknown, name: string): unknown {
  if (!isRecord(args) || !(name in args)) {
    throw new Error(`Missing ${name} argument`);
  }
  return args[name];
}

export function parseWebSettings(value: unknown): ParsedStorage<AppSettings> {
  const settings = { ...DEFAULT_WEB_SETTINGS };
  if (!isRecord(value)) return { value: settings, malformed: true };

  let malformed = !hasOnlyKeys(value, Object.keys(DEFAULT_WEB_SETTINGS));
  const booleanFields = [
    "auto_pull_on_connect",
    "skip_push_verification",
    "snap_to_iso_frequencies",
    "floating_graph_preview",
  ] as const;
  for (const field of booleanFields) {
    if (!(field in value)) continue;
    if (typeof value[field] === "boolean") {
      settings[field] = value[field];
    } else {
      malformed = true;
    }
  }
  if ("theme" in value) {
    if (typeof value.theme === "string") {
      settings.theme = value.theme;
    } else {
      malformed = true;
    }
  }
  return { value: settings, malformed };
}

function parseFilterType(value: unknown): FilterType | null {
  switch (value) {
    case "PK":
    case "Peak":
      return "Peak";
    case "LSQ":
    case "LSC":
    case "LowShelf":
      return "LowShelf";
    case "HSQ":
    case "HSC":
    case "HighShelf":
      return "HighShelf";
    case "HP":
    case "HighPass":
      return "HighPass";
    case "LP":
    case "LowPass":
      return "LowPass";
    default:
      return null;
  }
}

function parseStoredFilter(value: unknown): Filter | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "index", "enabled", "type", "filter_type", "freq", "gain", "q",
  ])) {
    return null;
  }
  const filterType = parseFilterType(value.filter_type ?? value.type);
  const aliasesConflict = value.filter_type !== undefined && value.type !== undefined &&
    parseFilterType(value.filter_type) !== parseFilterType(value.type);
  if (
    !Number.isInteger(value.index) ||
    typeof value.index !== "number" ||
    value.index < 0 ||
    value.index > 255 ||
    typeof value.enabled !== "boolean" ||
    !Number.isInteger(value.freq) ||
    typeof value.freq !== "number" ||
    value.freq <= 0 ||
    value.freq > 65_535 ||
    typeof value.gain !== "number" ||
    !Number.isFinite(value.gain) ||
    typeof value.q !== "number" ||
    !Number.isFinite(value.q) ||
    value.q <= 0 ||
    !filterType ||
    aliasesConflict
  ) {
    return null;
  }
  return {
    index: value.index,
    enabled: value.enabled,
    filter_type: filterType,
    freq: value.freq,
    gain: value.gain,
    q: value.q,
  };
}

function parseStoredPeq(value: unknown): PEQData | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["filters", "globalGain", "global_gain"])) {
    return null;
  }
  if (!Array.isArray(value.filters) || value.filters.length > 32) return null;
  const globalGain = value.global_gain ?? value.globalGain;
  const aliasesConflict = value.global_gain !== undefined && value.globalGain !== undefined &&
    value.global_gain !== value.globalGain;
  if (typeof globalGain !== "number" || !Number.isFinite(globalGain) || aliasesConflict) {
    return null;
  }
  const filters: Filter[] = [];
  for (const candidate of value.filters) {
    const filter = parseStoredFilter(candidate);
    if (!filter) return null;
    filters.push(filter);
  }
  return { filters, global_gain: globalGain };
}

function isValidProfileName(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    value.endsWith(".") ||
    ![...value].every((character) => /[\p{L}\p{N}]/u.test(character) || " _-@+&.()".includes(character))
  ) {
    return false;
  }
  const finalDot = value.lastIndexOf(".");
  const stem = (finalDot > 0 ? value.slice(0, finalDot) : value).toUpperCase();
  return ![
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ].includes(stem);
}

function parseStoredProfile(value: unknown): Profile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name", "data", "modified"])) return null;
  if (!isValidProfileName(value.name)) return null;
  const data = parseStoredPeq(value.data);
  const modified = value.modified;
  if (
    !data ||
    !(modified === null || (
      typeof modified === "number" && Number.isSafeInteger(modified) && modified >= 0
    ))
  ) {
    return null;
  }
  return { name: value.name, data, modified };
}

export function parseWebProfiles(value: unknown): ParsedStorage<Profile[]> {
  if (!Array.isArray(value)) return { value: [], malformed: true };
  const profiles: Profile[] = [];
  const names = new Set<string>();
  let malformed = false;
  for (const candidate of value) {
    const profile = parseStoredProfile(candidate);
    const normalizedName = profile?.name.toLocaleLowerCase();
    if (!profile || !normalizedName || names.has(normalizedName)) {
      malformed = true;
      continue;
    }
    names.add(normalizedName);
    profiles.push(profile);
  }
  return { value: profiles, malformed };
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function quarantineStorage(key: string, raw: string, safeValue: unknown): void {
  try {
    let suffix = Date.now();
    let backupKey = `${key}-malformed-${suffix}`;
    while (localStorage.getItem(backupKey) !== null) {
      backupKey = `${key}-malformed-${++suffix}`;
    }
    localStorage.setItem(backupKey, raw);
    saveJson(key, safeValue);
  } catch {
    // Keep the original value if storage is full or unavailable.
  }
}

function loadValidatedStorage<T>(
  key: string,
  fallback: T,
  parser: (value: unknown) => ParsedStorage<T>,
): T {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineStorage(key, raw, fallback);
    return fallback;
  }
  const result = parser(parsed);
  if (result.malformed) quarantineStorage(key, raw, result.value);
  return result.value;
}

function loadWebSettings(): AppSettings {
  return loadValidatedStorage("glacier-eq-settings", DEFAULT_WEB_SETTINGS, parseWebSettings);
}

function loadWebProfiles(): Profile[] {
  return loadValidatedStorage("glacier-eq-profiles", [], parseWebProfiles);
}

function parseAutoEqResultPeq(value: unknown): PEQData {
  if (!isRecord(value) || !("peq" in value)) {
    throw new Error("Invalid AutoEQ response");
  }
  const peq = parseStoredPeq(value.peq);
  if (!peq) throw new Error("Invalid PEQ data in AutoEQ response");
  return peq;
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

function connectedProfile(): SupportedDeviceInfo {
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
    } catch (error) {
      if (!activeDevice) throw error;
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
    } catch (error) {
      if (!activeDevice) throw error;
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

export function peqVerificationError(
  actual: PEQData,
  expected: PEQData,
  capabilities: Pick<
    DeviceCapabilities,
    "supports_per_band_enable" | "gain_tolerance" | "freq_tolerance" | "q_tolerance"
  >,
): string | null {
  if (Math.abs(actual.global_gain - expected.global_gain) > 0.001) {
    return `Global gain mismatch: expected ${expected.global_gain}, got ${actual.global_gain}`;
  }
  if (actual.filters.length !== expected.filters.length) {
    return `Filter count mismatch: expected ${expected.filters.length}, got ${actual.filters.length}`;
  }

  const gainTolerance = capabilities.gain_tolerance ?? 0.15;
  const freqTolerance = capabilities.freq_tolerance ?? 1;
  const qTolerance = capabilities.q_tolerance ?? 0.05;
  for (let index = 0; index < expected.filters.length; index++) {
    const actualFilter = actual.filters[index];
    const expectedFilter = expected.filters[index];
    const expectedGain = expectedFilter.enabled ? expectedFilter.gain : 0;
    const metadataMismatch = expectedFilter.enabled && (
      Math.abs(actualFilter.freq - expectedFilter.freq) > freqTolerance ||
      Math.abs(actualFilter.q - expectedFilter.q) > qTolerance ||
      actualFilter.filter_type !== expectedFilter.filter_type
    );
    if (
      Math.abs(actualFilter.gain - expectedGain) > gainTolerance ||
      metadataMismatch ||
      (capabilities.supports_per_band_enable && actualFilter.enabled !== expectedFilter.enabled)
    ) {
      return `Band ${expectedFilter.index + 1} mismatch`;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function persistentPushFailureMessage(pushError: unknown, restoreError: unknown | null): string {
  const push = errorMessage(pushError);
  return restoreError === null
    ? `Persistent push failed: ${push}; previous state restored`
    : `Persistent push failed: ${push}; restore failed: ${errorMessage(restoreError)}`;
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
      connectedProfile().dsp_sample_rate || 96000.0,
      peq.global_gain,
    ));
    await sleep(timing.per_filter_ms || 80);
  }

  emitEvent("operation-progress", { message: "Writing preamp...", percentage: 75 });
  await sleep(timing.batch_ms || 100);
  await sendPackets(build_write_global_gain_packets(protocol, peq.global_gain));
  await sleep(timing.global_gain_ms || 50);
}

async function commitEqPayload(protocol: string, progressMessage: string): Promise<void> {
  const timing = get_write_timing(protocol);
  emitEvent("operation-progress", { message: progressMessage, percentage: 80 });
  for (const packet of build_commit_packets(protocol)) {
    await sendReport(packet);
    await sleep(timing.commit_step_ms || 100);
  }
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

const SAVE_TEXT_DIALOG_TOKEN = "tauri-save-text-dialog:";

function parseSaveTextDialogRequest(args: unknown): { content: string; defaultName: string } | null {
  if (typeof args !== "object" || args === null || !("path" in args) || !("content" in args)) {
    return null;
  }
  if (typeof args.path !== "string" || !args.path.startsWith(SAVE_TEXT_DIALOG_TOKEN)) {
    return null;
  }
  if (typeof args.content !== "string") {
    throw new Error("Invalid text export content");
  }
  const encodedName = args.path.slice(SAVE_TEXT_DIALOG_TOKEN.length);
  let defaultName: string;
  try {
    defaultName = decodeURIComponent(encodedName);
  } catch {
    throw new Error("Invalid text export file name");
  }
  return { content: args.content, defaultName };
}

export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    if (cmd === "save_text_file") {
      const dialogRequest = parseSaveTextDialogRequest(args);
      if (dialogRequest) {
        return tauriInvoke<T>("save_text_file_dialog", dialogRequest);
      }
    }
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
      return loadWebSettings() as T;
    }
    case "save_settings": {
      const settings = parseWebSettings(commandField(args, "settings"));
      saveJson("glacier-eq-settings", settings.value);
      return null as T;
    }

    // ─── Profiles / Presets ─────────────────────────────────────────────────
    case "list_profiles": {
      return loadWebProfiles() as T;
    }
    case "save_profile": {
      // Mirror ProfileStore::save's envelope so both platforms enforce
      // identical limits instead of trusting the IPC payload verbatim.
      const name = commandField(args, "name");
      if (!isValidProfileName(name)) {
        throw new Error("Profile name contains invalid characters");
      }
      const peq = parseStoredPeq(commandField(args, "peq"));
      if (!peq || peq.filters.length > 32) {
        throw new Error("Profile exceeds maximum filter count (32) or contains invalid data");
      }
      const text = peq_to_autoeq(peq);
      if (text.length > 1_048_576) {
        throw new Error("Profile exceeds maximum size (1 MiB)");
      }
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      const normalized = parseAutoEqResultPeq(parse_autoeq(text, vid, pid));
      const profiles = loadWebProfiles();
      const normalizedName = name.toLocaleLowerCase();
      const idx = profiles.findIndex((profile) => profile.name.toLocaleLowerCase() === normalizedName);
      const newProfile: Profile = {
        name,
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
      const name = commandField(args, "name");
      if (!isValidProfileName(name)) throw new Error("Invalid profile name");
      const profiles = loadWebProfiles();
      saveJson("glacier-eq-profiles", profiles.filter((profile) => profile.name !== name));
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
      const peq = parseStoredPeq(commandField(args, "peq"));
      if (!peq) throw new Error("Invalid PEQ data for profile matching");
      const profiles = loadWebProfiles();
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      return match_profile_name(peq, profiles, vid, pid) as T;
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
        let filter: Filter | null = null;

        for (let retry = 0; retry < 3; retry++) {
          try {
            await sendReport(filterReq);
            const res = await readMatchingReport(250, (data) => matches_filter_response(protocol, data, i, nonce));
            if (res) {
              filter = parseStoredFilter(parse_filter_response(protocol, res));
              if (!filter) throw new Error(`Invalid band ${i + 1} response`);
              break;
            }
          } catch (error) {
            if (!activeDevice) throw error;
            console.warn(`Retry ${retry + 1} reading band ${i} failed:`, error);
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
      const peq = constrainPeqToBandCount(args.peq, profile.num_bands);
      const skipVerification = loadWebSettings().skip_push_verification;

      if (skipVerification) {
        await writeEqPayload(protocol, peq, "Initializing unverified push connection...");
        await commitEqPayload(protocol, "Committing unverified changes to device...");
        emitEvent("operation-progress", { message: "Write complete (unverified)", percentage: 100 });
        return null as T;
      }

      const backup = constrainPeqToBandCount(
        await invokeWeb<PEQData>("get_eq_state"),
        profile.num_bands,
      );
      try {
        await writeEqPayload(protocol, peq, "Initializing push connection...");
        await commitEqPayload(protocol, "Committing changes to device...");
        const actual = await invokeWeb<PEQData>("get_eq_state");
        const mismatch = peqVerificationError(actual, peq, profile);
        if (mismatch) throw new Error(mismatch);
      } catch (pushError) {
        let restoreError: unknown | null = null;
        try {
          await writeEqPayload(protocol, backup, "Restoring previous device state...");
          await commitEqPayload(protocol, "Committing restored device state...");
          const restored = await invokeWeb<PEQData>("get_eq_state");
          const mismatch = peqVerificationError(restored, backup, profile);
          if (mismatch) throw new Error(mismatch);
        } catch (error) {
          restoreError = error;
        }
        throw new Error(persistentPushFailureMessage(pushError, restoreError));
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

interface FileDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export async function save(options?: FileDialogOptions): Promise<string | null> {
  const defaultName = options?.defaultPath || "profile.txt";
  if (isTauri()) {
    // The following save_text_file invocation sends this opaque suggestion to
    // the backend-owned dialog command. No selected path crosses IPC.
    return `${SAVE_TEXT_DIALOG_TOKEN}${encodeURIComponent(defaultName)}`;
  }
  return defaultName;
}

function parseOpenedTextFile(value: unknown): { text: string; name: string } | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    throw new Error("Invalid open-file response from backend");
  }
  return { text: value.text, name: value.name };
}

export async function openFileDialog(options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<{ text: string; name: string } | null> {
  if (isTauri()) {
    return parseOpenedTextFile(await invoke<unknown>("open_text_file_dialog"));
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
