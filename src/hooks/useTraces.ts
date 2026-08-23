import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  makeMeasurementName,
  makeTargetName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
  resolveTargetColor,
} from "../lib/measurements";
import {
  parsePersistedMeasurements,
  parsePersistedTargets,
} from "../lib/persistedTraces";
import type { MeasurementTrace, TargetTrace } from "../types";

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
  notify?: (message: string) => void,
) {
  // Keep the same timestamped backup convention for syntax and schema damage.
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    window.localStorage.setItem(`${key}.bak.${stamp}`, raw);
  } catch {
    // Backup write failed (likely the same quota problem) — give up quietly.
  }
  notify?.(
    `Saved data for "${key}" was corrupted and could not be loaded; a backup copy was kept for recovery.`,
  );
}

export function loadPersistedJson(
  key: string,
  notify?: (message: string) => void,
): LoadedPersistedJson {
  const raw = window.localStorage.getItem(key);
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
  if (!Array.isArray(value)) return { value: [], malformed: true };

  const measurements: MeasurementTrace[] = [];
  let malformed = false;
  for (const candidate of value) {
    try {
      const parsed = parsePersistedMeasurements([candidate]);
      if (parsed.length !== 1) {
        malformed = true;
        continue;
      }
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
  if (!Array.isArray(value)) return { value: [], malformed: true };

  const targets: TargetTrace[] = [];
  let malformed = false;
  for (const candidate of value) {
    try {
      const parsed = parsePersistedTargets([candidate]);
      if (parsed.length !== 1) {
        malformed = true;
        continue;
      }
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
  notify?: (message: string) => void,
) {
  if (malformed && loaded.raw !== null) {
    quarantinePersistedJson(key, loaded.raw, notify);
  }
}

function usePersistedJson(
  key: string,
  value: unknown,
  hydrated: boolean,
  delayMs = 0,
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

    const save = () => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        // Storage may be full (private mode, quota). Fail soft rather than
        // crashing the app — the in-memory state is still intact.
        const quota =
          error instanceof DOMException ||
          (error as { name?: string } | null)?.name === "QuotaExceededError";
        if (quota) {
          console.warn(`localStorage quota exceeded while saving "${key}".`);
        } else {
          console.error(`Failed to save "${key}" to localStorage:`, error);
        }
      }
    };
    saveRef.current = save;
    if (delayMs <= 0) {
      save();
      return;
    }
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, hydrated, delayMs]);

  // The debounce timer dies with the document before its callback runs, so
  // flush synchronously when the page is being hidden or unloaded.
  useEffect(() => {
    if (delayMs <= 0) return;
    const flush = () => saveRef.current();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [delayMs]);
}

export function useTraces(notify?: (message: string) => void) {
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const [measurementsHydrated, setMeasurementsHydrated] = useState(false);
  const [targetsHydrated, setTargetsHydrated] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);

  const allTargets = userTargets;

  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );

  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    const key = "glacier-measurements";
    const saved = loadPersistedJson(key, (msg) => notifyRef.current?.(msg));
    const parsed = saved.raw === null
      ? { value: [], malformed: false }
      : parseStoredMeasurements(saved.value);
    quarantineIfMalformed(key, saved, parsed.malformed, (msg) => notifyRef.current?.(msg));
    setMeasurements(parsed.value);
    setMeasurementsHydrated(true);
  }, []);

  usePersistedJson("glacier-measurements", measurements, measurementsHydrated, 300);

  useEffect(() => {
    const targetsKey = "glacier-user-targets";
    const savedTargets = loadPersistedJson(targetsKey, (msg) => notifyRef.current?.(msg));
    const parsedTargets = savedTargets.raw === null
      ? { value: [], malformed: false }
      : parseStoredTargets(savedTargets.value);
    quarantineIfMalformed(
      targetsKey,
      savedTargets,
      parsedTargets.malformed,
      (msg) => notifyRef.current?.(msg),
    );
    setUserTargets(parsedTargets.value);

    const existingTargetIds = new Set(
      parsedTargets.value.map((target) => target.id),
    );
    const activeIdsKey = "glacier-active-targets";
    const savedActiveIds = loadPersistedJson(activeIdsKey, (msg) => notifyRef.current?.(msg));
    const parsedActiveIds = savedActiveIds.raw === null
      ? { value: [], malformed: false }
      : parseStoredActiveTargetIds(savedActiveIds.value, existingTargetIds);
    quarantineIfMalformed(
      activeIdsKey,
      savedActiveIds,
      parsedActiveIds.malformed,
      (msg) => notifyRef.current?.(msg),
    );
    setActiveTargetIds(parsedActiveIds.value);
    setTargetsHydrated(true);
  }, []);

  usePersistedJson("glacier-user-targets", userTargets, targetsHydrated, 300);
  usePersistedJson("glacier-active-targets", activeTargetIds, targetsHydrated, 300);

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
          name: makeTargetName(name, [...current]),
          color: resolveTargetColor(current.length),
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
