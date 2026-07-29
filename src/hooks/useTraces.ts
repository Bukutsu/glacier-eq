import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeMeasurementName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
} from "../lib/measurements";
import {
  getBuiltInTargets,
  makeTargetName,
  resolveTargetColor,
} from "../lib/targetReferences";
import type { MeasurementTrace, TargetTrace } from "../types";

function loadPersistedJson<T>(key: string): T | null {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

function usePersistedJson(key: string, value: unknown, delayMs = 0) {
  useEffect(() => {
    const save = () => window.localStorage.setItem(key, JSON.stringify(value));
    if (delayMs <= 0) {
      save();
      return;
    }
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);
}

export function useTraces() {
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const builtInTargets = useMemo(getBuiltInTargets, []);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);

  const allTargets = useMemo(
    () => [...builtInTargets, ...userTargets],
    [builtInTargets, userTargets],
  );

  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );

  useEffect(() => {
    const saved = loadPersistedJson<any[]>("glacier-measurements");
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
            Array.isArray(trace.points),
        )
        .map((trace) => ({
          ...trace,
          points: normalizeMeasurementPoints(trace.points),
        })),
    );
  }, []);

  usePersistedJson("glacier-measurements", measurements, 300);

  useEffect(() => {
    const savedTargets = loadPersistedJson<any[]>("glacier-user-targets");
    if (Array.isArray(savedTargets)) {
      setUserTargets(
        savedTargets
          .filter(
            (target): target is TargetTrace =>
              target &&
              typeof target.id === "string" &&
              typeof target.name === "string" &&
              typeof target.color === "string" &&
              Array.isArray(target.points),
          )
          .map((target) => ({
            ...target,
            builtIn: false,
            points: normalizeMeasurementPoints(target.points),
          })),
      );
    }

    const savedActiveIds = loadPersistedJson<any[]>("glacier-active-targets");
    if (
      Array.isArray(savedActiveIds) &&
      savedActiveIds.every((id) => typeof id === "string")
    ) {
      setActiveTargetIds(savedActiveIds);
    }
  }, []);

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
      setUserTargets((current) => {
        const nextTarget = {
          id: `user-target:${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
          name: makeTargetName(name, [...builtInTargets, ...current]),
          color: resolveTargetColor(builtInTargets.length + current.length),
          builtIn: false,
          points: normalizeMeasurementPoints(points),
        };
        setActiveTargetIds((activeIds) => [...activeIds, nextTarget.id]);
        return [...current, nextTarget];
      });
    },
    [builtInTargets],
  );

  const removeTarget = useCallback((id: string) => {
    setUserTargets((current) => current.filter((target) => target.id !== id));
    setActiveTargetIds((current) =>
      current.filter((targetId) => targetId !== id),
    );
  }, []);

  return {
    measurements,
    setMeasurements,
    userTargets,
    setUserTargets,
    builtInTargets,
    allTargets,
    activeTargetIds,
    setActiveTargetIds,
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
