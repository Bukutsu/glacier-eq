/**
 * A notification the user must be able to report. `type` is the severity the
 * diagnostic event is filed under — stated here rather than inferred
 * downstream, because App's keyword classifier files every one of these at
 * Info: "Could not save ... storage is full" is data loss, and Info is what a
 * user sees under the default All filter.
 */
type NotifyFn = (message: string, type?: "info" | "error" | "success") => void;

/**
 * Builds the notifier handed to the persistence helpers.
 *
 * One adapter rather than nine inline arrows: a `(msg) => …` wrapper accepts
 * the optional severity as a parameter TypeScript will not force anyone to
 * forward, so it was silently dropped at every call site and the level fell
 * back to App's keyword classifier — which files "Could not save … storage is
 * full" as Info. The helpers were correct; the wiring between them and the
 * notifier was not, and no test drove that wiring.
 */
export function forwardNotifyFrom(ref: { current: NotifyFn | undefined }): NotifyFn {
  return (message, type) => ref.current?.(message, type);
}


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  makeMeasurementName,
  makeTargetName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
  resolveTargetColor,
} from "../lib/measurements";
import {
  MAX_PERSISTED_TRACES,
  parsePersistedMeasurements,
  parsePersistedTargets,
} from "../lib/persistedTraces";
import type { MeasurementTrace, TargetTrace } from "../types";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";
import { readLocalStorage, tryWriteLocalStorage } from "../lib/safeStorage";

interface LoadedPersistedJson {
  value: unknown;
  raw: string | null;
}

interface ParsedPersistedValue<T> {
  value: T;
  malformed: boolean;
}

function quarantinePersistedJson(
  key: string,
  raw: string,
  notify?: NotifyFn,
) {
  // Keep the same timestamped backup convention for syntax and schema damage.
  let backedUp = false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = tryWriteLocalStorage(`${key}.bak.${stamp}`, raw);
  backedUp = result.ok;
  if (!backedUp) {
    // Backup write failed (likely the same quota problem that damaged the
    // data). Never announce a copy that does not exist.
    console.warn(`Could not back up malformed saved data for "${key}":`, result.error);
  }
  notify?.(
    backedUp
      ? `Could not load saved data for "${key}". Created a backup copy.`
      : `Could not load saved data for "${key}", and no backup copy could be written (storage full?) — the damaged original was left in place.`,
    "error",
  );
}

export function loadPersistedJson(
  key: string,
  notify?: NotifyFn,
): LoadedPersistedJson {
  const raw = readLocalStorage(key);
  if (raw === null) return { value: null, raw: null };
  try {
    return { value: JSON.parse(raw), raw };
  } catch {
    quarantinePersistedJson(key, raw, notify);
    return { value: null, raw: null };
  }
}

export function parseStoredMeasurements(
  value: unknown,
): ParsedPersistedValue<MeasurementTrace[]> {
  if (!Array.isArray(value) || value.length > MAX_PERSISTED_TRACES) {
    return { value: [], malformed: true };
  }

  const measurements: MeasurementTrace[] = [];
  const seenIds = new Set<string>();
  let malformed = false;
  for (const candidate of value) {
    try {
      const parsed = parsePersistedMeasurements([candidate]);
      if (parsed.length !== 1) {
        malformed = true;
        continue;
      }
      // IDs key every remove/toggle action; a duplicate would make one click
      // affect two traces, so treat collisions like any other schema damage.
      if (seenIds.has(parsed[0].id)) {
        malformed = true;
        continue;
      }
      seenIds.add(parsed[0].id);
      const points = typeof candidate === "object" && candidate !== null && "points" in candidate
        ? candidate.points
        : null;
      if (!Array.isArray(points) || parsed[0].points.length !== points.length) {
        malformed = true;
      }
      measurements.push(parsed[0]);
    } catch {
      malformed = true;
    }
  }
  return { value: measurements, malformed };
}

export function parseStoredTargets(
  value: unknown,
): ParsedPersistedValue<TargetTrace[]> {
  if (!Array.isArray(value) || value.length > MAX_PERSISTED_TRACES) {
    return { value: [], malformed: true };
  }

  const targets: TargetTrace[] = [];
  const seenIds = new Set<string>();
  let malformed = false;
  for (const candidate of value) {
    try {
      const parsed = parsePersistedTargets([candidate]);
      if (parsed.length !== 1) {
        malformed = true;
        continue;
      }
      // One ID must map to one action, and a saved ID must never shadow a
      // built-in target; both collisions mark the storage malformed.
      if (seenIds.has(parsed[0].id) || BUILTIN_TARGETS.some((t) => t.id === parsed[0].id)) {
        malformed = true;
        continue;
      }
      seenIds.add(parsed[0].id);
      const points = typeof candidate === "object" && candidate !== null && "points" in candidate
        ? candidate.points
        : null;
      if (!Array.isArray(points) || parsed[0].points.length !== points.length) {
        malformed = true;
      }
      targets.push(parsed[0]);
    } catch {
      malformed = true;
    }
  }
  return { value: targets, malformed };
}

export function parseStoredActiveTargetIds(
  value: unknown,
  existingTargetIds: ReadonlySet<string>,
): ParsedPersistedValue<string[]> {
  if (!Array.isArray(value)) return { value: [], malformed: true };

  const activeTargetIds = value.filter(
    (id): id is string => typeof id === "string" && existingTargetIds.has(id),
  );
  return {
    value: activeTargetIds,
    malformed: activeTargetIds.length !== value.length,
  };
}

export function quarantineIfMalformed(
  key: string,
  loaded: LoadedPersistedJson,
  malformed: boolean,
  notify?: NotifyFn,
) {
  if (malformed && loaded.raw !== null) {
    quarantinePersistedJson(key, loaded.raw, notify);
  }
}

export function savePersistedJson(
  key: string,
  value: unknown,
  notify?: NotifyFn,
) {
  try {
    const result = tryWriteLocalStorage(key, JSON.stringify(value));
    if (result.ok) return;
    const error = result.error;
    const quota =
      error instanceof DOMException ||
      (error as { name?: string } | null)?.name === "QuotaExceededError";
    if (quota) {
      console.warn(`localStorage quota exceeded while saving "${key}".`);
      notify?.(
        `Could not save "${key}" — storage is full. Recent changes may be lost when the app closes.`,
        "error",
      );
    } else {
      console.error(`Failed to save "${key}" to localStorage:`, error);
      notify?.(`Could not save "${key}" to local storage: ${error}`, "error");
    }
  } catch (error) {
    // JSON serialization can still fail for an unexpected caller value.
    console.error(`Failed to serialize "${key}" for localStorage:`, error);
    notify?.(`Could not save "${key}" to local storage: ${error}`, "error");
  }
}

function usePersistedJson(
  key: string,
  value: unknown,
  hydrated: boolean,
  delayMs = 0,
  notify?: NotifyFn,
) {
  // Latest save routine, so a pagehide flush always persists current state.
  // Keep it inert until hydration has completed so an early pagehide cannot
  // replace stored data with the initial state.
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!hydrated) {
      saveRef.current = () => {};
      return;
    }

    const save = () => savePersistedJson(key, value, notify);
    saveRef.current = save;
    if (delayMs <= 0) {
      save();
      return;
    }
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, hydrated, delayMs, notify]);

  // The debounce timer dies with the document before its callback runs, so
  // flush synchronously when the page is being hidden or unloaded.
  useEffect(() => {
    if (delayMs <= 0) return;
    const flush = () => saveRef.current();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [delayMs]);
}

export function useTraces(notify?: NotifyFn) {
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const [measurementsHydrated, setMeasurementsHydrated] = useState(false);
  const [targetsHydrated, setTargetsHydrated] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);

  const allTargets = useMemo(
    () => [...BUILTIN_TARGETS, ...userTargets],
    [userTargets],
  );

  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );

  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  const forwardNotify = forwardNotifyFrom(notifyRef);

  useEffect(() => {
    const key = "glacier-measurements";
    const saved = loadPersistedJson(key, forwardNotify);
    const parsed = saved.raw === null
      ? { value: [], malformed: false }
      : parseStoredMeasurements(saved.value);
    quarantineIfMalformed(key, saved, parsed.malformed, forwardNotify);
    setMeasurements(parsed.value);
    setMeasurementsHydrated(true);
  }, []);

  usePersistedJson(
    "glacier-measurements",
    measurements,
    measurementsHydrated,
    300,
    forwardNotify,
  );

  useEffect(() => {
    const targetsKey = "glacier-user-targets";
    const savedTargets = loadPersistedJson(targetsKey, forwardNotify);
    const parsedTargets = savedTargets.raw === null
      ? { value: [], malformed: false }
      : parseStoredTargets(savedTargets.value);
    quarantineIfMalformed(
      targetsKey,
      savedTargets,
      parsedTargets.malformed,
      forwardNotify,
    );
    setUserTargets(parsedTargets.value);

    const existingTargetIds = new Set([
      ...BUILTIN_TARGETS.map((target) => target.id),
      ...parsedTargets.value.map((target) => target.id),
    ]);
    const activeIdsKey = "glacier-active-targets";
    const savedActiveIds = loadPersistedJson(activeIdsKey, forwardNotify);
    const parsedActiveIds = savedActiveIds.raw === null
      ? { value: [], malformed: false }
      : parseStoredActiveTargetIds(savedActiveIds.value, existingTargetIds);
    quarantineIfMalformed(
      activeIdsKey,
      savedActiveIds,
      parsedActiveIds.malformed,
      forwardNotify,
    );
    setActiveTargetIds(
      savedActiveIds.raw === null && BUILTIN_TARGETS.length > 0
        ? [BUILTIN_TARGETS[0].id]
        : parsedActiveIds.value,
    );
    setTargetsHydrated(true);
  }, []);

  usePersistedJson(
    "glacier-user-targets",
    userTargets,
    targetsHydrated,
    300,
    forwardNotify,
  );
  usePersistedJson(
    "glacier-active-targets",
    activeTargetIds,
    targetsHydrated,
    300,
    forwardNotify,
  );

  const addMeasurement = useCallback(
    (name: string, points: MeasurementTrace["points"]) => {
      setMeasurements((current) => [
        ...current,
        {
          id: `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
          name: makeMeasurementName(name, current),
          color: nextMeasurementColor(current),
          visible: true,
          points: normalizeMeasurementPoints(points),
        },
      ]);
    },
    [],
  );

  const removeMeasurement = useCallback((id: string) => {
    setMeasurements((current) => current.filter((trace) => trace.id !== id));
  }, []);

  const toggleMeasurement = useCallback((id: string) => {
    setMeasurements((current) =>
      current.map((trace) =>
        trace.id === id ? { ...trace, visible: !trace.visible } : trace,
      ),
    );
  }, []);

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const toggleTarget = useCallback((id: string) => {
    setActiveTargetIds((current) =>
      current.includes(id)
        ? current.filter((targetId) => targetId !== id)
        : [...current, id],
    );
  }, []);

  const addTarget = useCallback(
    (name: string, points: TargetTrace["points"]) => {
      const id = `user-target:${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      setUserTargets((current) => [
        ...current,
        {
          id,
          name: makeTargetName(name, [...BUILTIN_TARGETS, ...current]),
          color: resolveTargetColor(BUILTIN_TARGETS.length + current.length),
          builtIn: false,
          points: normalizeMeasurementPoints(points),
        },
      ]);
      setActiveTargetIds((activeIds) => [...activeIds, id]);
    },
    [],
  );

  const removeTarget = useCallback((id: string) => {
    setUserTargets((current) => current.filter((target) => target.id !== id));
    setActiveTargetIds((current) =>
      current.filter((targetId) => targetId !== id),
    );
  }, []);

  return {
    measurements,
    allTargets,
    activeTargetIds,
    activeTargets,
    selectedMeasurementId,
    setSelectedMeasurementId,
    addMeasurement,
    removeMeasurement,
    toggleMeasurement,
    clearMeasurements,
    toggleTarget,
    addTarget,
    removeTarget,
  };
}
