import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeMeasurementName,
  makeTargetName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
  resolveTargetColor,
} from "../lib/measurements";
import type { MeasurementTrace, TargetTrace } from "../types";

function loadPersistedJson<T>(
  key: string,
  notify?: (message: string) => void,
): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
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

function usePersistedJson(key: string, value: unknown, delayMs = 0) {
  useEffect(() => {
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
    if (delayMs <= 0) {
      save();
      return;
    }
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);
}

export function useTraces(notify?: (message: string) => void) {
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);

  const allTargets = useMemo(
    () => [...userTargets],
    [userTargets],
  );

  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );

  useEffect(() => {
    const saved = loadPersistedJson<any[]>("glacier-measurements", notify);
    if (!Array.isArray(saved)) return;

    setMeasurements(
      saved
        .filter(
          (trace): trace is MeasurementTrace =>
            trace &&
            typeof trace.id === "string" &&
            typeof trace.name === "string" &&
            typeof trace.color === "string" &&
            typeof trace.visible === "boolean" &&
            Array.isArray(trace.points) &&
            trace.points.length >= 2,
        )
        .map((trace) => ({
          ...trace,
          points: normalizeMeasurementPoints(trace.points),
        })),
    );
  }, [notify]);

  usePersistedJson("glacier-measurements", measurements, 300);

  useEffect(() => {
    const savedTargets = loadPersistedJson<any[]>("glacier-user-targets", notify);
    const loadedUserTargets: TargetTrace[] = Array.isArray(savedTargets)
      ? savedTargets
          .filter(
            (target): target is TargetTrace =>
              target &&
              typeof target.id === "string" &&
              typeof target.name === "string" &&
              typeof target.color === "string" &&
              Array.isArray(target.points) &&
              target.points.length >= 2,
          )
          .map((target) => ({
            ...target,
            builtIn: false,
            points: normalizeMeasurementPoints(target.points),
          }))
      : [];
    setUserTargets(loadedUserTargets);

    // Prune active ids that no longer reference an existing target.
    const existingTargetIds = new Set(
      loadedUserTargets.map((target) => target.id),
    );
    const savedActiveIds = loadPersistedJson<any[]>("glacier-active-targets", notify);
    if (
      Array.isArray(savedActiveIds) &&
      savedActiveIds.every((id) => typeof id === "string")
    ) {
      setActiveTargetIds(savedActiveIds.filter((id) => existingTargetIds.has(id)));
    }
  }, [notify]);

  usePersistedJson("glacier-user-targets", userTargets, 300);
  usePersistedJson("glacier-active-targets", activeTargetIds);

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
