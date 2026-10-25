/// <reference types="w3c-web-hid" />
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { parseResponseModel } from "@/features/device/lib/responseModel";
import type {
  AppSettings,
  Filter,
  FilterType,
  PEQData,
  Profile,
  SupportedDeviceInfo,
} from "@/types";
import { ensureWasm, getWasm } from "./wasm";
import { profileIdentityKey } from "@/features/profiles/lib/profileIdentity";
import type { DiagnosticEvent } from "@/features/diagnostics/lib/diagnostics";
import {
  isDiagnosticLevel,
  isDiagnosticSource,
  sanitizeDiagnosticMessage,
} from "@/features/diagnostics/lib/diagnostics";
import { readLocalStorage, writeLocalStorage } from "@/lib/safeStorage";
import { DISCONNECT_SUPERSEDED } from "@/lib/asyncContext";
import { themeOptions } from "@/features/settings/lib/theme";

// Wasm entry points are resolved lazily: ensureWasm() has already run on every
// path that reaches them (invokeWeb awaits it before dispatching), so the
// wasm binary stays off the startup-critical chunk graph.
const wasm = () => getWasm();

// ─── Browser Event Bus ───────────────────────────────────────────────────────

// `unknown`, not `any`: the desktop adapter already declares payload as
// unknown, and because listen<T> lets a subscriber pick T, an `any` here let
// a future emitter corrupt component state with no type check anywhere.
const eventListeners: {
  [event: string]: ((event: { payload: unknown }) => void)[];
} = {};

export async function listen<T>(
  event: string,
  callback: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!eventListeners[event]) {
    eventListeners[event] = [];
  }
  // A trampoline rather than a cast: the registry is the untrusted side, and
  // asserting the subscriber's T onto it re-permits exactly the hole the
  // `unknown` declaration removed. The subscriber still owns the narrowing
  // from there, which is the one place it can legitimately happen.
  const wrapped = (event: { payload: unknown }) => {
    callback(event as { payload: T });
  };
  eventListeners[event].push(wrapped);
  return () => {
    eventListeners[event] = eventListeners[event].filter(
      (cb) => cb !== wrapped,
    );
  };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  emitEvent(event, payload);
}

function emitEvent(event: string, payload: unknown) {
  const listeners = eventListeners[event];
  if (listeners) {
    listeners.forEach((cb) => cb({ payload }));
  }
}

let webHidDisconnectListenerInstalled = false;
const webHidDisconnectEpochs = new WeakMap<HIDDevice, number>();

function ensureWebHid(): HID {
  const hid = navigator.hid;
  if (!hid) {
    throw new Error(
      "WebHID is not available. Use a Chromium-based browser over HTTPS or localhost.",
    );
  }
  if (!webHidDisconnectListenerInstalled) {
    hid.addEventListener("disconnect", (event: HIDConnectionEvent) => {
      const device: HIDDevice = event.device;
      webHidDisconnectEpochs.set(
        device,
        (webHidDisconnectEpochs.get(device) ?? 0) + 1,
      );
      markWebHidDisconnected(device);
    });
    webHidDisconnectListenerInstalled = true;
  }
  return hid;
}

export function matchSupportedWebHidDevice(
  device: Pick<HIDDevice, "vendorId" | "productId"> & { productName?: string },
  supportedDevices: SupportedDeviceInfo[],
): SupportedDeviceInfo | undefined {
  // Mirror get_supported_device (glacier-core): an exact PID match wins over
  // a vendor-level fallback regardless of list order, so web and desktop
  // classify the same VID/PID identically even if the registry is reordered.
  return (
    supportedDevices.find(
      (supported) =>
        supported.vendor_id === device.vendorId &&
        supported.product_id === device.productId,
    ) ??
    supportedDevices.find(
      (supported) =>
        supported.vendor_id === device.vendorId &&
        (supported.name !== "FIIO QX11" || device.productId === 0x0130) &&
        (supported.name !== "FIIO BT11" || device.productId === 0x4032) &&
        (supported.name !== "FIIO Air Link" || device.productId === 0x4033) &&
        supported.usb_product_names?.some(
          (name) =>
            name.toLowerCase() === device.productName?.trim().toLowerCase(),
        ),
    ) ??
    supportedDevices.find(
      (supported) =>
        supported.vendor_id === device.vendorId &&
        supported.product_id == null &&
        !supported.usb_product_names?.length,
    )
  );
}

// ─── WebHID Active State ──────────────────────────────────────────────────────

let activeDevice: HIDDevice | null = null;
let activeProfile: SupportedDeviceInfo | null = null;
let activeSessionId: number | null = null;
let nextWebHidSessionId = 1;
// markWebHidDisconnected cannot wait on close() — it runs on the failure path
// of the very send that failed — but a connect_device for the same HIDDevice
// must not be allowed to observe the stale opened === true while the close is
// still in flight. HIDDevice.close() leaves the device "closing" until the
// platform releases the interface, and HIDDevice.open() rejects with
// InvalidStateError unless the device is already "closed", so a connect that
// races the close would either claim a device our own cleanup is closing or
// fail with an opaque error the frontend cannot interpret. Track the close
// here and let connect_device settle it before claiming the device.
let pendingWebHidClose: Promise<void> | null = null;
const webHidIds = new WeakMap<HIDDevice, number>();
let nextWebHidId = 1;

/**
 * `manufacturerName` is a WebHID addition the DOM lib does not declare, so
 * it is read through a narrowing helper rather than by annotating every
 * device as `any` — which would also have discarded the parameter types of
 * matchSupportedWebHidDevice and webHidPath.
 */
function webHidManufacturer(device: HIDDevice): string {
  const value = (device as { manufacturerName?: unknown }).manufacturerName;
  return typeof value === "string" ? value : "";
}

function webHidPath(device: HIDDevice): string {
  let id = webHidIds.get(device);
  if (!id) {
    id = nextWebHidId++;
    webHidIds.set(device, id);
  }
  return `webhid:${device.vendorId}:${device.productId}:${id}`;
}

// Memory Diagnostic Store for Web mode. Sequence IDs let the diagnostics UI
// deduplicate history against the live buffer without relying on identical
// millisecond timestamps.
const MAX_DIAGNOSTICS = 500;
let diagnosticsSequence = 0;
// `level`/`source` are typed so an emitter cannot introduce a value the
// diagnostic-event parser rejects: an invalid source would drop the live
// event AND throw inside parseDiagnosticHistory, breaking history load.
let diagnosticsStore: {
  seq: number;
  level: DiagnosticEvent["level"];
  source: DiagnosticEvent["source"];
  message: string;
  timestamp: string;
}[] = [];

function addDiagnostic(
  level: DiagnosticEvent["level"],
  source: DiagnosticEvent["source"],
  message: string,
) {
  // Single funnel for every web emitter (quarantine, WebRPC log, the
  // add_diagnostic_event command): sanitize like desktop's record()/command
  // so stored and emitted messages match the desktop contract byte-for-byte.
  const event = {
    seq: ++diagnosticsSequence,
    level,
    source,
    message: sanitizeDiagnosticMessage(message),
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
let nextFilterNonce = 0;

const inputReportListeners = new Map<
  HIDDevice,
  (event: HIDInputReportEvent) => void
>();

function detachHidEventListeners(device?: HIDDevice | null) {
  if (!device) return;
  const listener = inputReportListeners.get(device);
  if (listener) {
    device.removeEventListener("inputreport", listener);
    inputReportListeners.delete(device);
  }
}

function markWebHidDisconnected(device?: HIDDevice) {
  if (!activeDevice || (device && activeDevice !== device)) return;
  const target = device || activeDevice;
  detachHidEventListeners(target);
  // Release the OS-level interface now, because no path can after
  // activeDevice is null: disconnect_device is a no-op without an active
  // device, and connect_device only closes a previous device while it is
  // still set. This function is the receiver of send failures on a device
  // that is still present and enumerated, so without this close the opened
  // handle — and the HID interface it claims — would strand for the rest of
  // the page lifetime. Mirrors handle_disconnection's hid_close on the Rust
  // side; failures are swallowed because the device may already be gone and
  // the disconnect is reported regardless. The close is not awaited here, but
  // it is recorded so a later connect_device can settle it before deciding
  // the device is still open.
  const closing = target.close().catch(() => {});
  pendingWebHidClose = closing;
  void closing.then(() => {
    if (pendingWebHidClose === closing) pendingWebHidClose = null;
  });
  // Structured identity lets listeners reject delayed events for a session
  // that has already been replaced.
  const sessionId = activeSessionId;
  const payload = {
    path: webHidPath(activeDevice),
    name: activeProfile?.name || activeDevice.productName || "WebHID device",
    ...(sessionId !== null ? { session_id: sessionId } : {}),
  };
  activeDevice = null;
  activeProfile = null;
  activeSessionId = null;
  reportQueue = [];
  while (reportResolvers.length > 0) {
    const resolver = reportResolvers.shift();
    if (resolver) resolver(new Uint8Array(0));
  }
  emitEvent("device-disconnected", payload);
}

function setupHidEventListeners(device: HIDDevice) {
  detachHidEventListeners(device);

  const listener = (event: HIDInputReportEvent) => {
    const bytes = new Uint8Array(
      event.data.buffer,
      event.data.byteOffset,
      event.data.byteLength,
    );
    const framed = new Uint8Array(bytes.length + 1);
    framed[0] = event.reportId;
    framed.set(bytes, 1);
    addDiagnostic("Info", "HID", `RX ${hidHex(framed)}`);

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

function hidHex(bytes: number[] | Uint8Array): string {
  let used = bytes.length;
  while (used > 0 && bytes[used - 1] === 0) used--;
  const hex = Array.from(bytes.slice(0, used), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  return (
    hex + (used < bytes.length ? ` (+${bytes.length - used} zero bytes)` : "")
  );
}

async function sendReport(packet: number[] | Uint8Array): Promise<void> {
  const device = activeDevice;
  if (!device) throw new Error("No device connected");
  try {
    await device.sendReport(packet[0], new Uint8Array(packet.slice(1)));
    addDiagnostic("Info", "HID", `TX ${hidHex(packet)}`);
  } catch (error) {
    addDiagnostic("Error", "HID", `TX failed ${hidHex(packet)}: ${error}`);
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

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface ParsedStorage<T> {
  value: T;
  malformed: boolean;
}

const DEFAULT_WEB_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  live_apply: false,
  theme: "tokyo-night",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

// Accept every UI theme, including Android themes in imported settings.
const KNOWN_THEMES = new Set<string>(
  themeOptions(true).map(({ value }) => value),
);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
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

  // Only a wrong-TYPED known key is corruption. Unknown keys are how a
  // newer or forked build writes settings this one doesn't know; desktop
  // round-trips them through serde's `extra` flatten, so the web mirror
  // must carry them through too — flagging them malformed quarantined and
  // destroyed the key on the first load→save cycle.
  let malformed = false;
  const booleanFields = [
    "auto_pull_on_connect",
    "skip_push_verification",
    "live_apply",
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
  const preservedThemeExtra: Record<string, unknown> = {};
  if ("theme" in value) {
    if (typeof value.theme === "string") {
      if (KNOWN_THEMES.has(value.theme)) {
        settings.theme = value.theme;
      } else {
        // Not corruption: a theme name this build does not offer is the
        // newer-or-forked-build case, so carry it through untouched. Only a
        // wrong type is malformed.
        preservedThemeExtra.theme = value.theme;
      }
    } else {
      malformed = true;
    }
  }
  const preserved: Record<string, unknown> = {
    ...settings,
    ...preservedThemeExtra,
  };
  const knownKeys = new Set(Object.keys(DEFAULT_WEB_SETTINGS));
  for (const [key, entry] of Object.entries(value)) {
    if (!knownKeys.has(key)) preserved[key] = entry;
  }
  // Unknown extras are intentionally untyped at the AppSettings level —
  // exactly like desktop, where serde's flatten serializes `extra` keys
  // into siblings the shared AppSettings interface doesn't declare.
  return { value: preserved as unknown as AppSettings, malformed };
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
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "index",
      "enabled",
      "type",
      "filter_type",
      "freq",
      "gain",
      "q",
    ])
  ) {
    return null;
  }
  const filterType = parseFilterType(value.filter_type ?? value.type);
  const aliasesConflict =
    value.filter_type !== undefined &&
    value.type !== undefined &&
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
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["filters", "globalGain", "global_gain"])
  ) {
    return null;
  }
  if (!Array.isArray(value.filters) || value.filters.length > 32) return null;
  const globalGain = value.global_gain ?? value.globalGain;
  const aliasesConflict =
    value.global_gain !== undefined &&
    value.globalGain !== undefined &&
    value.global_gain !== value.globalGain;
  if (
    typeof globalGain !== "number" ||
    !Number.isFinite(globalGain) ||
    aliasesConflict
  ) {
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
  // Match Rust's 128-byte UTF-8 limit rather than JS UTF-16 units.
  const utf8Bytes =
    typeof value === "string" ? new TextEncoder().encode(value).length : 0;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8Bytes > 128 ||
    value.trim() !== value ||
    value.endsWith(".") ||
    ![...value].every(
      (character) =>
        /[\p{Alphabetic}\p{N}]/u.test(character) ||
        " _-@+&.()".includes(character),
    )
  ) {
    return false;
  }
  const firstDot = value.indexOf(".");
  const stem = (firstDot >= 0 ? value.slice(0, firstDot) : value)
    .replace(/¹/g, "1")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .toUpperCase();
  if (stem === "DEFAULT EQ") return false;
  return ![
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ].includes(stem);
}

function parseStoredProfile(value: unknown): Profile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name", "data", "modified"]))
    return null;
  if (!isValidProfileName(value.name)) return null;
  const data = parseStoredPeq(value.data);
  const modified = value.modified;
  if (
    !data ||
    !(
      modified === null ||
      (typeof modified === "number" &&
        Number.isSafeInteger(modified) &&
        modified >= 0)
    )
  ) {
    return null;
  }
  return { name: value.name, data: clampToStorageEnvelope(data), modified };
}

// Storage envelope: the union of every supported device's capability ranges —
// mirrors storage_capabilities() in glacier-core/src/profiles.rs, which pins
// these same numbers in a test. Stored profiles are device-independent, so
// reads clamp to the envelope; clamping to the connected device happens later
// against its live capabilities.
const STORAGE_ENVELOPE = {
  globalGain: [-128, 16],
  bandGain: [-18, 16],
  freq: [20, 20_000],
  q: [0.1, 20],
} as const;

function clampToEnvelope(
  value: number,
  [min, max]: readonly [number, number],
): number {
  return Math.max(min, Math.min(max, value));
}

function clampToStorageEnvelope(data: PEQData): PEQData {
  return {
    global_gain: clampToEnvelope(data.global_gain, STORAGE_ENVELOPE.globalGain),
    filters: data.filters.map((filter) => ({
      ...filter,
      gain: clampToEnvelope(filter.gain, STORAGE_ENVELOPE.bandGain),
      freq: clampToEnvelope(filter.freq, STORAGE_ENVELOPE.freq),
      q: clampToEnvelope(filter.q, STORAGE_ENVELOPE.q),
    })),
  };
}

export function parseWebProfiles(value: unknown): ParsedStorage<Profile[]> {
  if (!Array.isArray(value)) return { value: [], malformed: true };
  const profiles: Profile[] = [];
  const names = new Set<string>();
  let malformed = false;
  for (const candidate of value) {
    const profile = parseStoredProfile(candidate);
    const normalizedName = profile ? profileIdentityKey(profile.name) : null;
    if (!profile || !normalizedName || names.has(normalizedName)) {
      malformed = true;
      continue;
    }
    names.add(normalizedName);
    profiles.push(profile);
  }
  return { value: profiles, malformed };
}

function saveJson(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (writeLocalStorage(key, serialized)) return true;
    throw new Error("local storage is unavailable or full");
  } catch (error) {
    console.warn(`Could not save ${key} to local storage`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function quarantineStorage(key: string, raw: string, safeValue: unknown): void {
  try {
    let suffix = Date.now();
    let backupKey = `${key}-malformed-${suffix}`;
    while (readLocalStorage(backupKey) !== null) {
      backupKey = `${key}-malformed-${++suffix}`;
    }
    if (!writeLocalStorage(backupKey, raw) || !saveJson(key, safeValue)) {
      throw new Error("local storage is unavailable or full");
    }
    // Without this the quarantine is invisible: the user's saved
    // settings/profiles were corrupt and just got replaced by the fallback,
    // yet the app claims nothing — the only trace is a `-malformed-` key
    // nobody knows to look for. Say what happened and where the original is.
    const message = `Malformed saved data for "${key}" was backed up to "${backupKey}" and replaced with a safe fallback.`;
    console.warn(message);
    addDiagnostic("Warn", "Storage", message);
  } catch (error) {
    // Keep the original value if storage is full or unavailable — but never
    // silently either: the malformed value stays behind, every later load
    // retries and fails the same way, and without a signal nobody learns
    // why their "saved" settings keep reverting to defaults.
    const message = `Malformed saved data for "${key}" could not be replaced (original kept, defaults used for this load): ${error}`;
    console.warn(message);
    addDiagnostic("Error", "Storage", message);
  }
}

function loadValidatedStorage<T>(
  key: string,
  fallback: T,
  parser: (value: unknown) => ParsedStorage<T>,
): T {
  const raw = readLocalStorage(key);
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
  return loadValidatedStorage(
    "glacier-eq-settings",
    DEFAULT_WEB_SETTINGS,
    parseWebSettings,
  );
}

function loadWebProfiles(): Profile[] {
  return loadValidatedStorage("glacier-eq-profiles", [], parseWebProfiles);
}

// The only browser-specific part of a device operation is transporting bytes.
// Pin the connection identity so a pending command cannot migrate to a replacement.
async function runDeviceOperation<T>(
  command: string,
  args?: unknown,
): Promise<T> {
  const device = activeDevice;
  const sessionId = activeSessionId;
  if (!device || !activeProfile) throw new Error("No device connected");
  const requireSession = () => {
    if (activeDevice !== device || activeSessionId !== sessionId) {
      throw new Error("Device disconnected or session changed");
    }
  };
  const io = {
    nonce: nextFilterNonce,
    async write(bytes: Uint8Array) {
      requireSession();
      await sendReport(bytes);
      requireSession();
    },
    async read(timeoutMs: number) {
      requireSession();
      try {
        const bytes = await readReport(timeoutMs);
        requireSession();
        return bytes;
      } catch (error) {
        requireSession();
        if (error instanceof WebHidReadTimeout) return new Uint8Array();
        throw error;
      }
    },
    sleep,
  };
  Object.assign(io, { productName: device.productName });
  const request = {
    ...(isRecord(args) ? args : {}),
    command,
    ...(command === "set_eq_state"
      ? { skip_verification: loadWebSettings().skip_push_verification }
      : {}),
  };
  try {
    return (await wasm().device_operation(
      device.vendorId,
      device.productId,
      io,
      request,
      (message: string, percentage: number) =>
        emitEvent("operation-progress", { message, percentage }),
      io.nonce,
    )) as T;
  } finally {
    // Rust publishes the last nonce it consumed on success and failure.
    // Keep allocation continuous without inspecting protocol packets here.
    nextFilterNonce = io.nonce;
  }
}

// ─── Tauri Command Mock Routing ──────────────────────────────────────────────

let webHidOperation = Promise.resolve();

// Only commands that can touch the active HID transport share this queue.
// Diagnostics, settings, profile storage, and CPU/WASM-only AutoEQ work must
// remain available while a device transfer is stuck.
const WEBHID_TRANSPORT_COMMANDS = new Set([
  "connect_device",
  "disconnect_device",
  "get_firmware_version",
  "get_eq_state",
  "set_eq_state",
  "apply_eq_state",
  "live_apply_eq_state",
  "get_dac_utility_state",
  "ja11_control",
  "melody_control",
  "melody_name",
  "set_user_eq_bank",
  "set_dac_filter_mode",
  "set_dac_work_mode",
  "set_dac_output_gain",
  "set_dac_balance",
  "set_mic_volume",
  "reset_device_eq",
  "reset_device_controls",
  "execute_factory_reset",
]);

/**
 * The generated wasm binding types `list_supported_devices()` as `any`, so
 * casting its result asserted a shape nothing had checked — and a missing
 * number became `undefined` where a number is expected, which `capabilities.
 * band_gain_range[0]` then turned into NaN. Parse it instead.
 *
 * Unreachable with the Rust serializer as it stands: EditorCapabilities
 * matches DeviceCapabilities field for field, and the device list is
 * compiled in, not fetched. This is here so a divergence between the Rust
 * DTO and the TypeScript type surfaces as a rejected device rather than as a
 * NaN filter.
 */
function parseSupportedDeviceInfo(value: unknown): SupportedDeviceInfo | null {
  if (!isRecord(value)) return null;
  const spec = value.spec;
  const pair = (raw: unknown): [number, number] | null =>
    Array.isArray(raw) &&
    raw.length === 2 &&
    isFiniteNumber(raw[0]) &&
    isFiniteNumber(raw[1])
      ? [raw[0], raw[1]]
      : null;
  if (
    (value.usb_product_names !== undefined &&
      (!Array.isArray(value.usb_product_names) ||
        value.usb_product_names.some(
          (name) => typeof name !== "string" || !name.trim(),
        ))) ||
    typeof value.name !== "string" ||
    typeof value.protocol !== "string" ||
    !isFiniteNumber(value.vendor_id) ||
    !(value.product_id === null || isFiniteNumber(value.product_id)) ||
    typeof value.status !== "string" ||
    typeof value.family !== "string" ||
    typeof value.hardware_eq !== "boolean" ||
    (value.user_eq_slots !== undefined &&
      (!Array.isArray(value.user_eq_slots) ||
        value.user_eq_slots.some(
          (slot) =>
            !isFiniteNumber(slot) ||
            !Number.isInteger(slot) ||
            slot < 0 ||
            slot > 255,
        ) ||
        new Set(value.user_eq_slots).size !== value.user_eq_slots.length)) ||
    !(
      value.controls === null ||
      value.controls === "walkplay" ||
      value.controls === "dawn_pro" ||
      value.controls === "ja11" ||
      value.controls === "melody"
    ) ||
    !(
      spec === null ||
      (isRecord(spec) &&
        ["name", "chip", "outputs"].every(
          (key) => typeof spec[key] === "string",
        ) &&
        ["maxPower", "decoding", "snr", "thd"].every(
          (key) => spec[key] === undefined || typeof spec[key] === "string",
        ))
    ) ||
    !isFiniteNumber(value.num_bands) ||
    typeof value.supports_per_band_enable !== "boolean" ||
    typeof value.supports_ram_apply !== "boolean" ||
    typeof value.integer_preamp !== "boolean"
  ) {
    return null;
  }
  const globalGainRange = pair(value.global_gain_range);
  const bandGainRange = pair(value.band_gain_range);
  const freqRange = pair(value.freq_range);
  const qRange = pair(value.q_range);
  if (!globalGainRange || !bandGainRange || !freqRange || !qRange) return null;
  if (!isFiniteNumber(value.dsp_sample_rate)) return null;
  let responseModel: SupportedDeviceInfo["response_model"];
  try {
    responseModel = parseResponseModel(value.response_model);
  } catch {
    return null;
  }
  // The three tolerances are optional on DeviceCapabilities, and the
  // consumers default them with `?? 0.15` and friends. Coercing with Number()
  // turned "absent" into "present and NaN" — and `??` never fires on NaN, so
  // the out-of-range band check below silently stopped rejecting anything.
  // Leave absent absent.
  const optionalNumber = (raw: unknown): number | undefined =>
    raw === undefined || raw === null
      ? undefined
      : isFiniteNumber(raw)
        ? raw
        : undefined;
  return {
    name: value.name,
    ...(Array.isArray(value.usb_product_names)
      ? {
          usb_product_names: value.usb_product_names.filter(
            (name): name is string => typeof name === "string",
          ),
        }
      : {}),
    protocol: value.protocol,
    vendor_id: value.vendor_id,
    product_id: value.product_id,
    status: value.status,
    family: value.family,
    hardware_eq: value.hardware_eq,
    controls: value.controls,
    spec: value.spec as SupportedDeviceInfo["spec"],
    user_eq_slots: Array.isArray(value.user_eq_slots)
      ? (value.user_eq_slots as number[])
      : [],
    num_bands: value.num_bands,
    global_gain_range: globalGainRange,
    band_gain_range: bandGainRange,
    freq_range: freqRange,
    q_range: qRange,
    supported_filter_types: Array.isArray(value.supported_filter_types)
      ? (value.supported_filter_types as FilterType[])
      : [],
    supports_per_band_enable: value.supports_per_band_enable,
    supports_ram_apply: value.supports_ram_apply,
    dsp_sample_rate: value.dsp_sample_rate,
    response_model: responseModel,
    gain_tolerance: optionalNumber(value.gain_tolerance),
    freq_tolerance: optionalNumber(value.freq_tolerance),
    q_tolerance: optionalNumber(value.q_tolerance),
    integer_preamp: value.integer_preamp,
  };
}

function listSupportedDevices(): SupportedDeviceInfo[] {
  const raw = wasm().list_supported_devices();
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: unknown) => parseSupportedDeviceInfo(entry))
    .filter((entry): entry is SupportedDeviceInfo => entry !== null);
}

function serializeWebHid<T>(operation: () => Promise<T>): Promise<T> {
  const result = webHidOperation.then(operation, operation);
  webHidOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: unknown,
): Promise<T> {
  const expectedSession = activeSessionId;
  const operation = () => {
    if (
      WEBHID_TRANSPORT_COMMANDS.has(cmd) &&
      cmd !== "connect_device" &&
      cmd !== "disconnect_device" &&
      expectedSession !== activeSessionId
    ) {
      throw new Error("Device session changed; operation was cancelled");
    }
    return invokeWeb<T>(cmd, args);
  };
  return WEBHID_TRANSPORT_COMMANDS.has(cmd)
    ? serializeWebHid(operation)
    : operation();
}

/** Diagnostics-plane commands that never call into the wasm module. */
const PURE_JS_COMMANDS = new Set([
  "get_diagnostics",
  "get_diagnostic_context",
  "add_diagnostic_event",
  "clear_diagnostics",
]);

async function invokeWeb<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  // These four commands run entirely on in-memory JS state (diagnostics
  // store, platform/device reads) and never touch wasm. Gating them behind
  // the wasm chunk made the ToolsPanel history load fail — and fall back to
  // a silent "No logs yet." — during a wasm fetch outage (wasm.ts retries
  // per call, so every panel open re-fails), a view the store can serve
  // without wasm.
  if (!PURE_JS_COMMANDS.has(cmd)) {
    // Ensure WASM is loaded first
    await ensureWasm();
  }

  // Log WebRPC calls to local diagnostics. Args are truncated: measurement and
  // AutoEQ payloads serialize to hundreds of KB per call.
  if (
    cmd !== "get_diagnostics" &&
    cmd !== "get_diagnostic_context" &&
    cmd !== "add_diagnostic_event"
  ) {
    const serialized = JSON.stringify(args || {});
    const summary =
      serialized.length > 200
        ? `${serialized.slice(0, 200)}…(${serialized.length} bytes)`
        : serialized;
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
      // Stored profiles are portable: validation is against the storage
      // envelope (schema, ≤32 filters), never the connected device's caps,
      // which would truncate multi-band profiles or pad preamp-only ones.
      const name = commandField(args, "name");
      if (!isValidProfileName(name)) {
        throw new Error("Profile name contains invalid characters");
      }
      const peq = parseStoredPeq(commandField(args, "peq"));
      if (!peq || peq.filters.length > 32) {
        throw new Error(
          "Profile exceeds maximum filter count (32) or contains invalid data",
        );
      }
      const normalizedPeq = clampToStorageEnvelope(peq);
      const serialized = JSON.stringify(normalizedPeq);
      if (serialized.length > 1_048_576) {
        throw new Error("Profile exceeds maximum size (1 MiB)");
      }
      const profiles = loadWebProfiles();
      const normalizedName = profileIdentityKey(name);
      const idx = profiles.findIndex(
        (profile) => profileIdentityKey(profile.name) === normalizedName,
      );
      const newProfile: Profile = {
        // Overwrites keep the stored spelling (case-only saves included),
        // mirroring ProfileStore::path, which rewrites the existing file
        // instead of renaming it to the caller's casing.
        name: idx >= 0 ? profiles[idx].name : name,
        data: normalizedPeq,
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
      // Mirror ProfileStore::path's ASCII case-insensitive lookup
      // (eq_ignore_ascii_case) so a delete for "daily" removes a stored
      // "Daily" exactly like the desktop backend — and nothing else does.
      const normalized = profileIdentityKey(name);
      saveJson(
        "glacier-eq-profiles",
        profiles.filter(
          (profile) => profileIdentityKey(profile.name) !== normalized,
        ),
      );
      return null as T;
    }
    case "rename_profile": {
      const from = commandField(args, "from");
      const to = commandField(args, "to");
      if (!isValidProfileName(from)) throw new Error("Invalid profile name");
      if (!isValidProfileName(to)) {
        throw new Error(
          "Profile name contains invalid characters. Use letters, numbers, spaces, and _-@+&.()",
        );
      }
      // Mirror ProfileStore::rename: keep the data, refuse to replace a
      // different profile, and allow case-only renames.
      const profiles = loadWebProfiles();
      const fromKey = profileIdentityKey(from);
      const index = profiles.findIndex(
        (profile) => profileIdentityKey(profile.name) === fromKey,
      );
      if (index < 0) throw new Error(`Profile not found: ${from}`);
      if (
        profileIdentityKey(to) !== fromKey &&
        profiles.some(
          (profile) =>
            profileIdentityKey(profile.name) === profileIdentityKey(to),
        )
      ) {
        throw new Error(`A profile named "${to}" already exists`);
      }
      profiles[index] = { ...profiles[index], name: to };
      saveJson("glacier-eq-profiles", profiles);
      return null as T;
    }
    case "open_profiles_dir": {
      alert(
        "Profiles are stored in browser localStorage. You can export/import them using the Profile tools.",
      );
      return null as T;
    }

    // ─── AutoEQ & Utilities ──────────────────────────────────────────────────
    case "list_supported_devices": {
      return listSupportedDevices() as T;
    }
    case "parse_autoeq": {
      const text = commandField(args, "text");
      if (typeof text !== "string") throw new Error("Invalid AutoEQ text");
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      return wasm().parse_autoeq(
        text,
        vid,
        pid,
        activeDevice?.productName,
      ) as T;
    }
    case "peq_to_autoeq": {
      const peq = commandField(args, "peq");
      return wasm().peq_to_autoeq(peq) as T;
    }
    case "match_profile_name": {
      const peq = parseStoredPeq(commandField(args, "peq"));
      if (!peq) throw new Error("Invalid PEQ data for profile matching");
      const profiles = loadWebProfiles();
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      return (wasm().match_profile_name(
        peq,
        profiles,
        vid,
        pid,
        activeDevice?.productName,
      ) ?? null) as T;
    }
    case "run_autoeq": {
      if (!isRecord(args)) throw new Error("Missing run_autoeq arguments");
      const vid = activeProfile?.vendor_id ?? null;
      const pid = activeProfile?.product_id ?? null;
      const measurementPoints =
        args.measurement_points ?? args.measurementPoints;
      const targetPoints = args.target_points ?? args.targetPoints;
      const nBands = args.n_bands ?? args.nBands;
      const steps = args.steps;
      const smoothType = args.smooth_type ?? args.smoothType;
      const fs = args.fs;
      if (!Array.isArray(measurementPoints)) {
        throw new Error("Invalid AutoEQ measurement points");
      }
      if (!Array.isArray(targetPoints)) {
        throw new Error("Invalid AutoEQ target points");
      }
      if (
        typeof nBands !== "number" ||
        !Number.isSafeInteger(nBands) ||
        nBands < 1
      ) {
        throw new Error("Invalid AutoEQ band count");
      }
      if (
        typeof steps !== "number" ||
        !Number.isSafeInteger(steps) ||
        steps < 1
      ) {
        throw new Error("Invalid AutoEQ step count");
      }
      if (typeof smoothType !== "string") {
        throw new Error("Invalid AutoEQ smoothing type");
      }
      if (typeof fs !== "number" || !Number.isFinite(fs)) {
        throw new Error("Invalid AutoEQ sample rate");
      }
      return wasm().run_autoeq(
        measurementPoints,
        targetPoints,
        nBands,
        steps,
        smoothType,
        fs,
        vid,
        pid,
        activeDevice?.productName,
      ) as T;
    }
    case "save_text_file": {
      // Mirror the desktop command's String serde plus tauri.ts:48-50's
      // guard: new Blob([42]) would happily stringify non-string content
      // and download a coerced file the desktop rejects outright.
      const content = commandField(args, "content");
      if (typeof content !== "string") {
        throw new Error("Invalid text export content");
      }
      // Read through the same accessor every other command uses, so a missing
      // path reports "Missing path argument" instead of a raw TypeError.
      const exportPath = commandField(args, "path");
      if (typeof exportPath !== "string") {
        throw new Error("Invalid text export path");
      }
      const filename = exportPath.split("/").pop() || "profile.txt";
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // Revoking synchronously can cancel the download before the browser
      // fetches the blob URL; give it time to complete.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return filename as T;
    }

    // ─── Diagnostics ────────────────────────────────────────────────────────
    case "get_diagnostic_context": {
      return {
        app_version: __APP_VERSION__,
        runtime: "Web",
        platform: navigator.userAgent,
        architecture: null,
        device_name: activeProfile?.name || activeDevice?.productName || null,
        device_id: activeDevice
          ? `${activeDevice.vendorId.toString(16).padStart(4, "0").toUpperCase()}:${activeDevice.productId.toString(16).padStart(4, "0").toUpperCase()}`
          : null,
        protocol: activeProfile?.protocol || null,
        transport: activeDevice ? "WebHID" : null,
      } as T;
    }
    case "add_diagnostic_event": {
      // Match the desktop command boundary (diagnostics.rs deserializes
      // level/source as enums and rejects out-of-union values): an invalid
      // event must not enter the store, where parseDiagnosticHistory would
      // later throw on it and blank the whole history view.
      const { level, source, message } = args as {
        level?: unknown;
        source?: unknown;
        message?: unknown;
      };
      if (
        !isDiagnosticLevel(level) ||
        !isDiagnosticSource(source) ||
        typeof message !== "string"
      ) {
        throw new Error("Invalid diagnostic event payload");
      }
      addDiagnostic(level, source, message);
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
      const supported = listSupportedDevices();
      return devices.flatMap((dev) => {
        const profile = matchSupportedWebHidDevice(dev, supported);
        if (!profile) return [];
        return [
          {
            ...profile,
            vendor_id: dev.vendorId,
            product_id: dev.productId,
            path: webHidPath(dev),
            manufacturer: webHidManufacturer(dev) || null,
            product_string: dev.productName || null,
            profile_name: profile.name,
          },
        ];
      }) as T;
    }
    case "connect_device": {
      // Use the same accessor every other command uses, so a missing path
      // reports "Missing path argument" instead of a raw TypeError from
      // dereferencing undefined.
      const requestedPath = commandField(args, "path");
      const devices = await ensureWebHid().getDevices();
      const target = devices.find(
        (dev: HIDDevice) => webHidPath(dev) === requestedPath,
      );
      if (
        !target ||
        !matchSupportedWebHidDevice(target, listSupportedDevices())
      ) {
        throw new Error(
          "Device is unsupported or unavailable. Select 'Scan for devices' to authorize a supported DAC.",
        );
      }

      const disconnectEpoch = webHidDisconnectEpochs.get(target);
      if (activeDevice && activeDevice !== target) {
        detachHidEventListeners(activeDevice);
        try {
          await activeDevice.close();
        } catch {}
        activeDevice = null;
        activeProfile = null;
        activeSessionId = null;
      }

      // Settle any close still in flight from a failed send before deciding
      // whether the device is open. Reading a stale opened === true here would
      // skip open() and hand out a session for a device the browser is in the
      // middle of closing.
      if (pendingWebHidClose) {
        const closing = pendingWebHidClose;
        pendingWebHidClose = null;
        await closing;
      }

      // Clear the previous identity before opening a replacement. If opening
      // fails, no diagnostic or later command may observe the old profile.
      activeProfile = null;
      activeSessionId = null;
      // A failed open must not leave a claimed device behind: with activeDevice
      // still set, get_firmware_version would report no firmware and
      // get_dac_utility_state would report the device as simply unsupported
      // rather than surfacing the open failure.
      activeDevice = null;
      if (!target.opened) {
        await target.open();
      }
      if (webHidDisconnectEpochs.get(target) !== disconnectEpoch) {
        // The global disconnect handler cannot clear an identity that has not
        // been installed yet. Fence a disconnect that raced open() explicitly.
        try {
          await target.close();
        } catch {}
        throw new Error(
          "Device disconnected while connecting. Reconnect the DAC and try again.",
        );
      }
      activeDevice = target;
      reportQueue = [];
      reportResolvers = [];
      setupHidEventListeners(target);

      const supported = listSupportedDevices();
      const found = matchSupportedWebHidDevice(target, supported);
      activeProfile = {
        ...found!,
        vendor_id: target.vendorId,
        product_id: target.productId,
      };
      activeSessionId = nextWebHidSessionId++;
      return activeSessionId as T;
    }
    case "disconnect_device": {
      // Refusing to close a replacement connection is the point of the fence,
      // but reporting it as success told the frontend it had disconnected while
      // this context still holds the device open. Name the outcome instead.
      const expectedPath = isRecord(args) ? args.expectedPath : undefined;
      const expectedSessionId = isRecord(args)
        ? args.expectedSessionId
        : undefined;
      if (
        activeDevice &&
        typeof expectedPath === "string" &&
        expectedPath !== webHidPath(activeDevice)
      ) {
        throw new Error(DISCONNECT_SUPERSEDED);
      }
      // Both fences must be armed by a supplied value and only by a supplied
      // value, matching disconnect_device's Option<String>/Option<u64>
      // arguments on the desktop: a caller that has no session id yet passes
      // null, and hasOwnProperty would read that as a mismatched session and
      // refuse the close while this context kept the HID interface claimed.
      if (
        activeDevice &&
        typeof expectedSessionId === "number" &&
        expectedSessionId !== activeSessionId
      ) {
        throw new Error(DISCONNECT_SUPERSEDED);
      }
      if (activeDevice) {
        detachHidEventListeners(activeDevice);
        let closeError: unknown = null;
        try {
          await activeDevice.close();
        } catch (error) {
          closeError = error;
        }
        activeDevice = null;
        activeProfile = null;
        activeSessionId = null;
        reportQueue = [];
        while (reportResolvers.length > 0) {
          const resolver = reportResolvers.shift();
          if (resolver) resolver(new Uint8Array(0));
        }
        if (closeError !== null) throw closeError;
      }
      // Also clear a stale profile if a previous replacement failed before
      // it could install a new active device.
      activeProfile = null;
      activeSessionId = null;
      reportQueue = [];
      while (reportResolvers.length > 0) {
        const resolver = reportResolvers.shift();
        if (resolver) resolver(new Uint8Array(0));
      }
      return null as T;
    }
    case "get_firmware_version":
    case "get_eq_state":
    case "set_eq_state":
    case "apply_eq_state":
    case "live_apply_eq_state":
    case "get_dac_utility_state":
      return await runDeviceOperation<T>(cmd, args);
    case "ja11_control": {
      if (
        !isRecord(args) ||
        !activeDevice ||
        activeProfile?.controls !== "ja11" ||
        args.path !== webHidPath(activeDevice)
      ) {
        throw new Error("These controls require the displayed JA11");
      }
      const { path: _path, ...request } = args;
      return await runDeviceOperation<T>(cmd, request);
    }
    case "set_user_eq_bank": {
      if (
        !isRecord(args) ||
        !activeDevice ||
        !activeProfile ||
        activeProfile.controls === "melody" ||
        args.path !== webHidPath(activeDevice)
      ) {
        throw new Error("These banks require the displayed FiiO device");
      }
      const { path: _path, ...request } = args;
      return await runDeviceOperation<T>(cmd, request);
    }
    case "melody_control":
    case "melody_name": {
      if (
        !isRecord(args) ||
        !activeDevice ||
        activeProfile?.controls !== "melody" ||
        args.path !== webHidPath(activeDevice)
      ) {
        throw new Error("These controls require the displayed SNOWSKY Melody");
      }
      const { path: _path, ...request } = args;
      return await runDeviceOperation<T>(cmd, request);
    }
    case "set_dac_filter_mode":
    case "set_dac_work_mode":
    case "set_dac_output_gain":
    case "set_dac_balance":
    case "set_mic_volume":
    case "reset_device_eq":
    case "reset_device_controls":
    case "execute_factory_reset":
      return await runDeviceOperation<T>(cmd, args);
    case "get_dawn_pro_state":
    case "set_dawn_pro_control":
      // WebHID has no Input GET_REPORT. A Feature Report is not a substitute.
      throw new Error(
        "Original Dawn Pro controls require the desktop app; WebHID cannot request its input GET_REPORT.",
      );

    default:
      // Match Tauri's unknown-command rejection: returning null would let
      // callers treat typos (e.g. get_udev_status on web) as success.
      throw new Error(`Unknown command: ${cmd}`);
  }
}

// Helper to trigger browser WebHID picker
export async function requestWebHidDevice(): Promise<void> {
  await ensureWasm();
  const supported = listSupportedDevices();
  const filters = supported.map((s) => ({
    vendorId: s.vendor_id,
    productId: s.product_id ?? undefined,
  }));

  const selected = await ensureWebHid().requestDevice({ filters });
  if (selected.length > 0) {
    // Not a console.log: addDiagnostic is in this module and is the path a
    // user's bug report reads, so an event the user can be asked about does
    // not belong on stdout.
    addDiagnostic(
      "Info",
      "HID",
      `WebHID device permitted: ${webHidPath(selected[0])}`,
    );
  }
}

export async function readText(): Promise<string> {
  return navigator.clipboard.readText();
}

export async function writeText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

interface FileDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export async function save(
  options?: FileDialogOptions,
): Promise<string | null> {
  return options?.defaultPath || "profile.txt";
}

export async function openFileDialog(_options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<{ text: string; name: string } | null> {
  throw new Error("Web imports require a file input");
}

export async function openUrl(url: string): Promise<void> {
  // Mirror the desktop's validate_browser_url. window.open honours a
  // javascript: URL in this origin, so without this the two adapters disagree
  // about which links may be opened and the web build loses the check the
  // Tauri build enforces.
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("Refused: only http and https URLs are allowed");
  }
  if (/[\u0000-\u001F\u007F\s]/.test(url)) {
    throw new Error("Refused: URL contains invalid characters");
  }
  if (typeof window !== "undefined") {
    // Passing noopener/noreferrer in windowFeatures forces window.open to
    // return null even on success (the new context has no opener), which
    // made popup-blocking indistinguishable from success — a blocked open
    // resolved the promise and did nothing, invisibly. Open without those
    // features and sever the opener handle instead: same guarantee, and a
    // null return now reliably means the popup was blocked.
    const opened = window.open(url, "_blank");
    if (!opened) {
      throw new Error("The browser blocked opening this link in a new tab");
    }
    opened.opener = null;
  }
}
