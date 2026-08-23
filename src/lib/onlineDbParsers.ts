const MAX_DEVICE_COUNT = 100_000;
const MAX_DEVICE_ID_LENGTH = 1_024;
const MAX_FREQUENCY_COUNT = 100_000;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;

export interface OnlineManifestDetails {
  price: number | null;
}

export interface OnlineManifest {
  iems: Record<string, OnlineManifestDetails>;
}

export interface OnlineCurves {
  frequencies: number[];
  curves: Record<string, number[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(section: string, reason: string): never {
  throw new Error(`Invalid online database ${section}: ${reason}`);
}

function validateDeviceId(id: string, section: string): void {
  if (!id.trim() || id.length > MAX_DEVICE_ID_LENGTH || id.startsWith("meta:")) {
    invalid(section, `unusable device ID ${JSON.stringify(id)}`);
  }
  const separator = id.indexOf("::");
  if (
    separator <= 0 ||
    separator === id.length - 2 ||
    !id.slice(0, separator).trim() ||
    !id.slice(separator + 2).trim()
  ) {
    invalid(section, `device ID ${JSON.stringify(id)} must contain a source and name`);
  }
}

export function parseOnlineManifest(value: unknown): OnlineManifest {
  if (!isRecord(value) || !isRecord(value.iems)) {
    invalid("manifest", "expected an object with an iems record");
  }

  const entries = Object.entries(value.iems);
  if (entries.length === 0 || entries.length > MAX_DEVICE_COUNT) {
    invalid("manifest", `iems must contain between 1 and ${MAX_DEVICE_COUNT} devices`);
  }

  const validatedEntries: [string, OnlineManifestDetails][] = [];
  for (const [id, details] of entries) {
    validateDeviceId(id, "manifest");
    if (!isRecord(details)) {
      invalid("manifest", `details for ${JSON.stringify(id)} must be an object`);
    }
    if (
      details.price !== null &&
      (typeof details.price !== "number" || !Number.isFinite(details.price))
    ) {
      invalid("manifest", `price for ${JSON.stringify(id)} must be finite or null`);
    }
    validatedEntries.push([id, { price: details.price }]);
  }

  return { iems: Object.fromEntries(validatedEntries) };
}

export function parseOnlineFrequencies(value: unknown): number[] {
  if (!Array.isArray(value)) {
    invalid("curves", "frequencies must be an array");
  }
  if (value.length < 2 || value.length > MAX_FREQUENCY_COUNT) {
    invalid("curves", `frequencies must contain between 2 and ${MAX_FREQUENCY_COUNT} values`);
  }

  const frequencies: number[] = [];
  let previous = -Infinity;
  for (const frequency of value) {
    if (
      typeof frequency !== "number" ||
      !Number.isFinite(frequency) ||
      frequency < MIN_FREQUENCY ||
      frequency > MAX_FREQUENCY
    ) {
      invalid("curves", `frequencies must be finite and within ${MIN_FREQUENCY}-${MAX_FREQUENCY} Hz`);
    }
    if (frequency <= previous) {
      invalid("curves", "frequencies must be strictly increasing");
    }
    frequencies.push(frequency);
    previous = frequency;
  }
  return frequencies;
}

export function parseOnlineCurveValues(
  value: unknown,
  expectedLength: number,
  deviceId?: string,
): number[] {
  const label = deviceId ? `curve ${JSON.stringify(deviceId)}` : "cached curve";
  if (!Array.isArray(value) || value.length !== expectedLength) {
    invalid("curves", `${label} must contain ${expectedLength} values`);
  }

  const values: number[] = [];
  for (const db of value) {
    if (typeof db !== "number" || !Number.isFinite(db)) {
      invalid("curves", `${label} must contain only finite numbers`);
    }
    values.push(db);
  }
  return values;
}

export function parseOnlineCurves(value: unknown): OnlineCurves {
  if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.curves)) {
    invalid("curves", "expected meta and curves records");
  }

  const frequencies = parseOnlineFrequencies(value.meta.frequencies);
  const entries = Object.entries(value.curves);
  if (entries.length === 0 || entries.length > MAX_DEVICE_COUNT) {
    invalid("curves", `curves must contain between 1 and ${MAX_DEVICE_COUNT} devices`);
  }

  const validatedEntries: [string, number[]][] = [];
  for (const [id, curve] of entries) {
    validateDeviceId(id, "curves");
    if (!isRecord(curve)) {
      invalid("curves", `curve ${JSON.stringify(id)} must be an object`);
    }
    validatedEntries.push([
      id,
      parseOnlineCurveValues(curve.d, frequencies.length, id),
    ]);
  }

  return {
    frequencies,
    curves: Object.fromEntries(validatedEntries),
  };
}
