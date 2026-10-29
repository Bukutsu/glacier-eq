import { i18n } from "@/lib/i18n";
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
function forwardNotifyFrom(ref: {
  current: NotifyFn | undefined;
}): NotifyFn {
  return (message, type) => ref.current?.(message, type);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  makeMeasurementName,
  makeTargetName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
  resolveTargetColor,
} from "@/features/traces/lib/measurements";
import {
  TRACE_LIBRARY_LIMIT,
  parsePersistedMeasurements,
  parsePersistedTargets,
} from "@/features/traces/lib/persistedTraces";
import type { MeasurementTrace, TargetTrace } from "@/types";
import { BUILTIN_TARGETS } from "@/features/traces/lib/builtinTargets";
import { readLocalStorage, tryWriteLocalStorage } from "@/lib/safeStorage";

interface LoadedPersistedJson {
  value: unknown;
  raw: string | null;
}

interface ParsedPersistedValue<T> {
  value: T;
  malformed: boolean;
}

// Keys whose malformed original has no backup. Writing the sanitized value
// would destroy the only copy, so saves skip them until a later load backs
// the original up.
const unprotectedKeys = new Set<string>();

function quarantinePersistedJson(key: string, raw: string, notify?: NotifyFn) {
  // Keep the same timestamped backup convention for syntax and schema damage.
  let backedUp = false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = tryWriteLocalStorage(`${key}.bak.${stamp}`, raw);
  backedUp = result.ok;
  if (backedUp) unprotectedKeys.delete(key);
  else unprotectedKeys.add(key);
  if (!backedUp) {
    // Backup write failed (likely the same quota problem that damaged the
    // data). Never announce a copy that does not exist.
    console.warn(
      `Could not back up malformed saved data for "${key}":`,
      result.error,
    );
  }
  notify?.(
    backedUp
      ? i18n.t("library:traces.backupCreated", {
          key: key,
        })
      : i18n.t("library:traces.backupFailed", {
          key: key,
        }),
    "error",
  );
}

function loadPersistedJson(
  key: string,
  notify?: NotifyFn,
): LoadedPersistedJson {
  // Each load re-decides: a failed quarantine below marks the key again.
  unprotectedKeys.delete(key);
  const raw = readLocalStorage(key);
  if (raw === null) return { value: null, raw: null };
  try {
    return { value: JSON.parse(raw), raw };
  } catch {
    quarantinePersistedJson(key, raw, notify);
    return { value: null, raw: null };
  }
}

function parseStoredMeasurements(
  value: unknown,
): ParsedPersistedValue<MeasurementTrace[]> {
  if (!Array.isArray(value)) return { value: [], malformed: true };

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
      const points =
        typeof candidate === "object" &&
        candidate !== null &&
        "points" in candidate
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

function parseStoredTargets(
  value: unknown,
): ParsedPersistedValue<TargetTrace[]> {
  if (!Array.isArray(value)) return { value: [], malformed: true };

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
      if (
        seenIds.has(parsed[0].id) ||
        BUILTIN_TARGETS.some((t) => t.id === parsed[0].id)
      ) {
        malformed = true;
        continue;
      }
      seenIds.add(parsed[0].id);
      const points =
        typeof candidate === "object" &&
        candidate !== null &&
        "points" in candidate
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

function parseStoredActiveTargetIds(
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

function quarantineIfMalformed(
  key: string,
  loaded: LoadedPersistedJson,
  malformed: boolean,
  notify?: NotifyFn,
) {
  if (malformed && loaded.raw !== null) {
    quarantinePersistedJson(key, loaded.raw, notify);
  }
}

function savePersistedJson(
  key: string,
  value: unknown,
  notify?: NotifyFn,
) {
  if (unprotectedKeys.has(key)) {
    console.warn(`Not saving "${key}": its malformed original has no backup.`);
    notify?.(
      i18n.t("library:traces.saveFailed", {
        key,
        error: "the damaged original has no backup and was kept",
      }),
      "error",
    );
    return;
  }
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
        i18n.t("library:traces.storageFull", {
          key: key,
        }),
        "error",
      );
    } else {
      console.error(`Failed to save "${key}" to localStorage:`, error);
      notify?.(
        i18n.t("library:traces.saveFailed", {
          key: key,
          error: error,
        }),
        "error",
      );
    }
  } catch (error) {
    // JSON serialization can still fail for an unexpected caller value.
    console.error(`Failed to serialize "${key}" for localStorage:`, error);
    notify?.(
      i18n.t("library:traces.saveFailed", {
        key: key,
        error: error,
      }),
      "error",
    );
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

// Additions return an ID (or throw) synchronously. Keep the latest event
// state in a ref so batched additions enforce the same limit before rendering.
function useTraceCollection<T>() {
  const [value, setValue] = useState<T[]>([]);
  const current = useRef(value);
  const update = useCallback((next: T[] | ((previous: T[]) => T[])) => {
    current.current = typeof next === "function" ? next(current.current) : next;
    setValue(current.current);
  }, []);
  return [value, update, current] as const;
}

function assertTraceCapacity(length: number) {
  if (length >= TRACE_LIBRARY_LIMIT) {
    throw new Error(
      i18n.t("library:traces.collectionLimit", { limit: TRACE_LIBRARY_LIMIT }),
    );
  }
}

export function useTraces(notify?: NotifyFn) {
  const [measurements, setMeasurements, measurementsRef] =
    useTraceCollection<MeasurementTrace>();
  const [userTargets, setUserTargets, userTargetsRef] =
    useTraceCollection<TargetTrace>();
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const [measurementsHydrated, setMeasurementsHydrated] = useState(false);
  const [targetsHydrated, setTargetsHydrated] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<
    string | null
  >(null);

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
  const [forwardNotify] = useState(() => forwardNotifyFrom(notifyRef));

  useEffect(() => {
    const key = "glacier-measurements";
    const saved = loadPersistedJson(key, forwardNotify);
    const parsed =
      saved.raw === null
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
    const parsedTargets =
      savedTargets.raw === null
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
    const parsedActiveIds =
      savedActiveIds.raw === null
        ? { value: [], malformed: false }
        : parseStoredActiveTargetIds(savedActiveIds.value, existingTargetIds);
    quarantineIfMalformed(
      activeIdsKey,
      savedActiveIds,
      parsedActiveIds.malformed,
      forwardNotify,
    );
    // Fresh installs start with a clean graph; saved selections are retained.
    setActiveTargetIds(parsedActiveIds.value);
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
      assertTraceCapacity(measurementsRef.current.length);
      const id = `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      setMeasurements((current) => [
        ...current,
        {
          id,
          name: makeMeasurementName(name, current),
          color: nextMeasurementColor(current),
          visible: true,
          points: normalizeMeasurementPoints(points),
        },
      ]);
      return id;
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

  /**
   * Adopt one measurement as the graph's only visible one. The tuning panel
   * calls this when its measurement dropdown changes, so the graph follows
   * the AutoEQ input instead of piling up every measurement that was ever
   * selected. The curve manager remains the explicit way back to overlays.
   */
  /** Show one measurement, plus an optional reference measurement. */
  const selectMeasurementOnly = useCallback(
    (id: string, referenceId?: string) => {
      setSelectedMeasurementId(id);
      const shown = (trace: { id: string }) =>
        trace.id === id || trace.id === referenceId;
      setMeasurements((current) =>
        current.every((trace) => trace.visible === shown(trace))
          ? current
          : current.map((trace) => ({ ...trace, visible: shown(trace) })),
      );
    },
    [],
  );

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

  /** Counterpart to selectMeasurementOnly for the target dropdown. */
  const selectTargetOnly = useCallback((id: string | null) => {
    setActiveTargetIds((current) => {
      if (id === null) return current.length === 0 ? current : [];
      return current.length === 1 && current[0] === id ? current : [id];
    });
  }, []);

  const addTarget = useCallback(
    (name: string, points: TargetTrace["points"]) => {
      assertTraceCapacity(userTargetsRef.current.length);
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
      return id;
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
    selectMeasurementOnly,
    clearMeasurements,
    toggleTarget,
    selectTargetOnly,
    addTarget,
    removeTarget,
  };
}
