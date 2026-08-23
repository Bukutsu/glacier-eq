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

function loadPersistedJson(
  key: string,
  notify?: (message: string) => void,
): unknown {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt stored data: keep a timestamped backup so it can be recovered
    // instead of being silently overwritten on the next save.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      window.localStorage.setItem(`${key}.bak.${stamp}`, raw);
    } catch {
      // Backup write failed (likely the same quota problem) — give up quietly.
    }
    notify?.(
      `Saved data for "${key}" was corrupted and could not be loaded; a backup copy was kept for recovery.`,
    );
    return null;
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
    const saved = loadPersistedJson("glacier-measurements", (msg) => notifyRef.current?.(msg));
    setMeasurements(parsePersistedMeasurements(saved));
    setMeasurementsHydrated(true);
  }, []);

  usePersistedJson("glacier-measurements", measurements, measurementsHydrated, 300);

  useEffect(() => {
    const savedTargets = loadPersistedJson("glacier-user-targets", (msg) => notifyRef.current?.(msg));
    const loadedUserTargets = parsePersistedTargets(savedTargets);
    setUserTargets(loadedUserTargets);

    // Prune active ids that no longer reference an existing target.
    const existingTargetIds = new Set(
      loadedUserTargets.map((target) => target.id),
    );
    const savedActiveIds = loadPersistedJson("glacier-active-targets", (msg) => notifyRef.current?.(msg));
    if (
      Array.isArray(savedActiveIds) &&
      savedActiveIds.every((id) => typeof id === "string")
    ) {
      setActiveTargetIds(savedActiveIds.filter((id) => existingTargetIds.has(id)));
    }
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
