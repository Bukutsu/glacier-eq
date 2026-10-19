import { i18n } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/rpc";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import { parseAutoEqResult } from "@/features/tuning/lib/parsedAutoEq";
import type { MeasurementTrace, PEQData, TargetTrace } from "@/types";

const EMPTY_TARGETS: TargetTrace[] = [];
const EMPTY_TARGET_IDS: string[] = [];

export interface AutoEqOptions {
  measurements: MeasurementTrace[];
  allTargets: TargetTrace[];
  activeTargetIds?: string[];
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  setStatus: (msg: string) => void;
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
  onToggleMeasurement?: (id: string) => void;
  onToggleTarget?: (id: string) => void;
  /**
   * Make one measurement the graph's only visible curve, and one target the
   * only active one. The tuning panel passes these so its dropdowns own the
   * graph view; without them the hook falls back to plain toggling.
   */
  onSelectMeasurementOnly?: (id: string) => void;
  onSelectTargetOnly?: (id: string) => void;
  maxBands?: number;
  dspSampleRate?: number;
  getAsyncContext: () => AsyncContext;
}

export function useAutoEq({
  measurements,
  allTargets = EMPTY_TARGETS,
  activeTargetIds = EMPTY_TARGET_IDS,
  onImportPEQ,
  setStatus,
  onSelectedMeasurementChange,
  onToggleMeasurement,
  onToggleTarget,
  onSelectMeasurementOnly,
  onSelectTargetOnly,
  maxBands = 10,
  dspSampleRate = 96000,
  getAsyncContext,
}: AutoEqOptions) {
  const { t } = useTranslation("library");
  const [nBands, setNBands] = useState<number>(Math.max(1, maxBands));
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(dspSampleRate);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasResult, setHasResult] = useState(false);
  const [failure, setFailure] = useState<
    { kind: "busy" } | { kind: "generation"; error: unknown } | null
  >(null);
  const requestRef = useRef(0);
  const optimizingRef = useRef(false);
  const mountedRef = useRef(true);

  const invalidateRequest = () => {
    requestRef.current += 1;
    optimizingRef.current = false;
    setIsOptimizing(false);
    setHasResult(false);
    setWarnings([]);
    setFailure(null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // An in-flight optimization is keyed to the measurement and targets it
    // was started for; changing either supersedes it. Say so, or the run
    // vanishes behind a cleared "Optimizing EQ..." with no explanation.
    const superseded = optimizingRef.current;
    requestRef.current += 1;
    optimizingRef.current = false;
    setIsOptimizing(false);
    setHasResult(false);
    setWarnings([]);
    setFailure(null);
    if (superseded) setStatus(i18n.t("library:autoEq.inputsChanged"));
  }, [measurements, allTargets, activeTargetIds]);

  useEffect(() => {
    requestRef.current += 1;
    optimizingRef.current = false;
    setIsOptimizing(false);
    setNBands((current) => Math.min(current, Math.max(1, maxBands)));
  }, [maxBands]);

  useEffect(() => {
    requestRef.current += 1;
    optimizingRef.current = false;
    setIsOptimizing(false);
    setFs(dspSampleRate);
  }, [dspSampleRate]);

  // Local selection states
  const [localMeasId, setLocalMeasId] = useState<string>("");
  const [localTargetId, setLocalTargetId] = useState<string>("");

  const applyMeasurementSelection = (id: string) => {
    setLocalMeasId(id);
    if (onSelectMeasurementOnly) {
      onSelectMeasurementOnly(id);
    } else if (!measurements.some((m) => m.id === id && m.visible)) {
      // Without an exclusive selection callback, fall back to revealing the
      // chosen input (same as the target side).
      onToggleMeasurement?.(id);
    }
  };

  const applyTargetSelection = (id: string) => {
    setLocalTargetId(id);
    if (onSelectTargetOnly) {
      onSelectTargetOnly(id);
    } else if (!activeTargetIds.includes(id)) {
      onToggleTarget?.(id);
    }
  };

  // Sync default measurement selection
  useEffect(() => {
    if (localMeasId && measurements.some((m) => m.id === localMeasId)) {
      return;
    }
    const visible = measurements.find((m) => m.visible);
    if (visible) {
      // Adopt one default as the graph's measurement so its dropdown, the
      // graph, and the Generate EQ input agree from the start.
      if (onSelectMeasurementOnly) onSelectMeasurementOnly(visible.id);
      else setLocalMeasId(visible.id);
    } else if (measurements.length > 0) {
      setLocalMeasId(measurements[0].id);
    } else {
      setLocalMeasId("");
    }
  }, [measurements, localMeasId, onSelectMeasurementOnly]);

  // Sync default target selection
  useEffect(() => {
    if (localTargetId && allTargets.some((t) => t.id === localTargetId)) {
      return;
    }
    const active = allTargets.find((t) => activeTargetIds.includes(t.id));
    if (active) {
      // Same adoption as the measurement side: the tuning panel's target is
      // the graph's target unless the user overrides it from the curve
      // manager.
      if (onSelectTargetOnly) onSelectTargetOnly(active.id);
      else setLocalTargetId(active.id);
    } else if (allTargets.length > 0) {
      setLocalTargetId(allTargets[0].id);
    } else {
      setLocalTargetId("");
    }
  }, [allTargets, activeTargetIds, localTargetId, onSelectTargetOnly]);

  // Sync selected measurement to parent for graph highlighting
  useEffect(() => {
    onSelectedMeasurementChange?.(localMeasId || null);
  }, [onSelectedMeasurementChange, localMeasId]);

  // Resolve measurement and target objects dynamically
  const meas =
    measurements.find((m) => m.id === localMeasId) ||
    measurements.find((m) => m.visible) ||
    measurements[0] ||
    null;
  const target =
    allTargets.find((t) => t.id === localTargetId) ||
    allTargets.find((t) => activeTargetIds.includes(t.id)) ||
    allTargets[0] ||
    null;

  const handleMeasChange = (id: string) => {
    const current = measurements.find((m) => m.id === localMeasId);
    if (id === localMeasId && current?.visible) return;
    invalidateRequest();
    applyMeasurementSelection(id);
  };

  const handleTargetChange = (id: string) => {
    // Bail out when the dropdown already shows this target, so re-picking it
    // cannot invalidate a result or re-hide curves the user turned back on.
    if (id === localTargetId && activeTargetIds.includes(id)) return;
    invalidateRequest();
    applyTargetSelection(id);
  };

  const handleRunAutoEq = async () => {
    if (!meas || !target || optimizingRef.current) return;

    const request = ++requestRef.current;
    const context = getAsyncContext();
    const input = {
      measurementName: meas.name,
      measurementPoints: meas.points.map((point) => [point.freq, point.db]),
      targetName: target.name,
      targetPoints: target.points.map((point) => [point.freq, point.db]),
      nBands,
      steps,
      smoothType,
      fs,
    };
    const isCurrent = () =>
      mountedRef.current &&
      request === requestRef.current &&
      asyncContextEquals(context, getAsyncContext());

    optimizingRef.current = true;
    setIsOptimizing(true);
    setHasResult(false);
    setStatus(i18n.t("library:autoEq.generatingEQ"));
    setWarnings([]);
    setFailure(null);

    try {
      const rawResult = await invoke<unknown>("run_autoeq", {
        measurementPoints: input.measurementPoints,
        targetPoints: input.targetPoints,
        nBands: input.nBands,
        steps: input.steps,
        smoothType: input.smoothType,
        fs: input.fs,
      });
      const result = parseAutoEqResult(rawResult);
      if (!isCurrent()) return;

      const cleanMeasName =
        input.measurementName.replace(/\s*\(.*?\)/g, "").trim() ||
        input.measurementName;
      const cleanTargetName =
        input.targetName
          .replace(/IE 2019/i, "IE")
          .replace(/OE 2018/i, "OE")
          .replace(/Preference \d+/i, "Pref")
          .replace(/PEQdb /i, "")
          .replace(/Reference/i, "")
          .trim() || input.targetName;
      const autoName = `${cleanMeasName} @ ${cleanTargetName}`;
      const applied = onImportPEQ(result.peq, autoName, false);
      if (!applied) {
        const message = i18n.t("library:autoEq.editorBusy");
        setFailure({ kind: "busy" });
        setStatus(message);
        return;
      }
      setWarnings(result.warnings);
      setHasResult(true);

      if (result.warnings.length > 0) {
        setStatus(
          i18n.t("library:autoEq.generatedWarnings", {
            count: result.warnings.length,
          }),
        );
      } else {
        setStatus(i18n.t("library:autoEq.generated"));
      }
    } catch (err) {
      if (isCurrent()) {
        const message = i18n.t("library:autoEq.couldNotGenerateEQ", {
          error: err,
        });
        setFailure({ kind: "generation", error: err });
        setStatus(message);
        console.error(err);
      }
    } finally {
      if (mountedRef.current && request === requestRef.current) {
        optimizingRef.current = false;
        setIsOptimizing(false);
      }
    }
  };

  return {
    nBands,
    setNBands,
    steps,
    setSteps,
    smoothType,
    setSmoothType,
    fs,
    setFs,
    isOptimizing,
    warnings,
    resultMessage: hasResult ? t("autoEq.reviewResult") : null,
    errorMessage: failure
      ? failure.kind === "busy"
        ? t("autoEq.editorBusy")
        : t("autoEq.couldNotGenerateEQ", { error: failure.error })
      : null,
    meas,
    target,
    invalidateRequest,
    handleMeasChange,
    handleTargetChange,
    handleRunAutoEq,
  };
}
