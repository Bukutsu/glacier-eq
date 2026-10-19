import { i18n } from "@/lib/i18n";
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
  throw new Error(
    i18n.t("library:onlineDbParsers.invalidOnlineDatabase", {
      section: section,
      reason: reason,
    }),
  );
}

function validateDeviceId(id: string, section: string): void {
  if (
    !id.trim() ||
    id.length > MAX_DEVICE_ID_LENGTH ||
    id.startsWith("meta:")
  ) {
    invalid(
      section,
      i18n.t("library:onlineDbParsers.unusableDeviceID", {
        id: JSON.stringify(id),
      }),
    );
  }
  const separator = id.indexOf("::");
  if (
    separator <= 0 ||
    separator === id.length - 2 ||
    !id.slice(0, separator).trim() ||
    !id.slice(separator + 2).trim()
  ) {
    invalid(
      section,
      i18n.t("library:onlineDbParsers.deviceIDMustContainASourceAndName", {
        id: JSON.stringify(id),
      }),
    );
  }
}

export function parseOnlineManifest(value: unknown): OnlineManifest {
  if (!isRecord(value) || !isRecord(value.iems)) {
    invalid(
      "manifest",
      i18n.t("library:onlineDbParsers.expectedAnObjectWithAnIemsRecord"),
    );
  }

  const entries = Object.entries(value.iems);
  if (entries.length === 0 || entries.length > MAX_DEVICE_COUNT) {
    invalid(
      "manifest",
      i18n.t("library:onlineDbParsers.iemsMustContainBetween1AndDevices", {
        limit: MAX_DEVICE_COUNT,
      }),
    );
  }

  const validatedEntries: [string, OnlineManifestDetails][] = [];
  for (const [id, details] of entries) {
    validateDeviceId(id, "manifest");
    if (!isRecord(details)) {
      invalid(
        "manifest",
        i18n.t("library:onlineDbParsers.detailsForMustBeAnObject", {
          id: JSON.stringify(id),
        }),
      );
    }
    if (
      details.price !== null &&
      (typeof details.price !== "number" || !Number.isFinite(details.price))
    ) {
      invalid(
        "manifest",
        i18n.t("library:onlineDbParsers.priceForMustBeFiniteOrNull", {
          id: JSON.stringify(id),
        }),
      );
    }
    validatedEntries.push([id, { price: details.price }]);
  }

  return { iems: Object.fromEntries(validatedEntries) };
}

export function parseOnlineFrequencies(value: unknown): number[] {
  if (!Array.isArray(value)) {
    invalid(
      "curves",
      i18n.t("library:onlineDbParsers.frequenciesMustBeAnArray"),
    );
  }
  if (value.length < 2 || value.length > MAX_FREQUENCY_COUNT) {
    invalid(
      "curves",
      i18n.t(
        "library:onlineDbParsers.frequenciesMustContainBetween2AndValues",
        { limit: MAX_FREQUENCY_COUNT },
      ),
    );
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
      invalid(
        "curves",
        i18n.t("library:onlineDbParsers.frequenciesMustBeFiniteAndWithinHz", {
          min: MIN_FREQUENCY,
          max: MAX_FREQUENCY,
        }),
      );
    }
    if (frequency <= previous) {
      invalid(
        "curves",
        i18n.t("library:onlineDbParsers.frequenciesMustBeStrictlyIncreasing"),
      );
    }
    frequencies.push(frequency);
    previous = frequency;
  }
  return frequencies;
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((db: unknown) => typeof db === "number" && Number.isFinite(db))
  );
}

export function parseOnlineCurveValues(
  value: unknown,
  expectedLength: number,
  deviceId?: string,
): number[] {
  const label = deviceId
    ? i18n.t("library:onlineDbParsers.curve", {
        id: JSON.stringify(deviceId),
      })
    : i18n.t("library:onlineDbParsers.cachedCurve");
  if (!Array.isArray(value) || value.length !== expectedLength) {
    invalid(
      "curves",
      i18n.t("library:onlineDbParsers.mustContainValues", {
        name: label,
        expectedLength: expectedLength,
      }),
    );
  }
  if (!isFiniteNumberArray(value)) {
    invalid(
      "curves",
      i18n.t("library:onlineDbParsers.mustContainOnlyFiniteNumbers", {
        name: label,
      }),
    );
  }
  return value;
}

export function parseOnlineCurves(value: unknown): OnlineCurves {
  if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.curves)) {
    invalid(
      "curves",
      i18n.t("library:onlineDbParsers.expectedMetaAndCurvesRecords"),
    );
  }

  const frequencies = parseOnlineFrequencies(value.meta.frequencies);
  const entries = Object.entries(value.curves);
  if (entries.length === 0 || entries.length > MAX_DEVICE_COUNT) {
    invalid(
      "curves",
      i18n.t("library:onlineDbParsers.curvesMustContainBetween1AndDevices", {
        limit: MAX_DEVICE_COUNT,
      }),
    );
  }

  const validatedEntries: [string, number[]][] = [];
  for (const [id, curve] of entries) {
    validateDeviceId(id, "curves");
    if (!isRecord(curve)) {
      invalid(
        "curves",
        i18n.t("library:onlineDbParsers.curveMustBeAnObject", {
          id: JSON.stringify(id),
        }),
      );
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
