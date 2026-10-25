import { i18n } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/rpc";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import { parseAutoEqResult } from "@/features/tuning/lib/parsedAutoEq";
import type { MeasurementTrace, PEQData, TargetTrace } from "@/types";

const EMPTY_TARGETS: TargetTrace[] = [];
const EMPTY_TARGET_IDS: string[] = [];

/** The curve AutoEQ matches: a target, or another headphone's measurement. */
export type AutoEqReference =
  | { kind: "target"; id: string }
  | { kind: "measurement"; id: string };

export function referenceValue(reference: AutoEqReference): string {
  return `${reference.kind}:${reference.id}`;
}

function parseReferenceValue(value: string): AutoEqReference | null {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (separator < 0 || !id) return null;
  return kind === "target" || kind === "measurement" ? { kind, id } : null;
}

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
   * Make one measurement the graph's only visible curve (plus a reference
   * measurement when matching headphone to headphone), and one target the
   * only active one (none for a measurement reference). The tuning panel
   * passes these so its dropdowns own the graph view; without them the hook
   * falls back to plain toggling.
   */
  onSelectMeasurementOnly?: (id: string, referenceId?: string) => void;
  onSelectTargetOnly?: (id: string | null) => void;
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
  const [localRef, setLocalRef] = useState<AutoEqReference | null>(null);
  const localTargetId = localRef?.kind === "target" ? localRef.id : "";
  // A measurement reference is valid only while it exists and differs from
  // the measurement being corrected.
  const refMeasId =
    localRef?.kind === "measurement" &&
    localRef.id !== localMeasId &&
    measurements.some((m) => m.id === localRef.id)
      ? localRef.id
      : null;

  /** Reveal a measurement, and when given, a reference measurement too. */
  const showMeasurements = (id: string, referenceId?: string) => {
    if (onSelectMeasurementOnly) {
      if (referenceId) onSelectMeasurementOnly(id, referenceId);
      else onSelectMeasurementOnly(id);
      return;
    }
    // Without an exclusive selection callback, fall back to revealing the
    // chosen inputs (same as the target side).
    for (const shown of referenceId ? [id, referenceId] : [id]) {
      if (!measurements.some((m) => m.id === shown && m.visible)) {
        onToggleMeasurement?.(shown);
      }
    }
  };

  const applyMeasurementSelection = (id: string) => {
    setLocalMeasId(id);
    // Matching a headphone to itself is meaningless; fall back to a target.
    if (localRef?.kind === "measurement" && localRef.id === id) {
      setLocalRef(null);
      showMeasurements(id);
      return;
    }
    showMeasurements(id, refMeasId ?? undefined);
  };

  const applyReferenceSelection = (reference: AutoEqReference) => {
    setLocalRef(reference);
    if (reference.kind === "measurement") {
      if (meas) showMeasurements(meas.id, reference.id);
      onSelectTargetOnly?.(null);
      return;
    }
    if (refMeasId && meas) showMeasurements(meas.id);
    if (onSelectTargetOnly) {
      onSelectTargetOnly(reference.id);
    } else if (!activeTargetIds.includes(reference.id)) {
      onToggleTarget?.(reference.id);
    }
  };

  // Sync default measurement selection
  useEffect(() => {
    if (localMeasId && measurements.some((m) => m.id === localMeasId)) {
      return;
    }
    const candidates = measurements.filter(
      (m) => localRef?.kind !== "measurement" || m.id !== localRef.id,
    );
    const visible = candidates.find((m) => m.visible);
    if (visible) {
      // Adopt one default as the graph's measurement so its dropdown, the
      // graph, and the Generate EQ input agree from the start.
      setLocalMeasId(visible.id);
      if (onSelectMeasurementOnly) {
        showMeasurements(
          visible.id,
          localRef?.kind === "measurement" ? localRef.id : undefined,
        );
      }
    } else if (candidates.length > 0) {
      setLocalMeasId(candidates[0].id);
    } else {
      setLocalMeasId("");
    }
  }, [measurements, localMeasId, localRef, onSelectMeasurementOnly]);

  // Sync default target selection
  useEffect(() => {
    if (refMeasId) return;
    if (localTargetId && allTargets.some((t) => t.id === localTargetId)) {
      return;
    }
    const active = allTargets.find((t) => activeTargetIds.includes(t.id));
    if (active) {
      // Same adoption as the measurement side: the tuning panel's target is
      // the graph's target unless the user overrides it from the curve
      // manager.
      setLocalRef({ kind: "target", id: active.id });
      onSelectTargetOnly?.(active.id);
    } else if (allTargets.length > 0) {
      // The dropdown shows a target even when none is on the graph. Draw it
      // too: a result cannot be judged without the curve it aimed for.
      setLocalRef({ kind: "target", id: allTargets[0].id });
      onSelectTargetOnly?.(allTargets[0].id);
    } else {
      setLocalRef(null);
    }
  }, [allTargets, activeTargetIds, localTargetId, refMeasId, onSelectTargetOnly]);

  // Sync selected measurement to parent for graph highlighting
  useEffect(() => {
    onSelectedMeasurementChange?.(localMeasId || null);
  }, [onSelectedMeasurementChange, localMeasId]);

  // Resolve measurement and reference objects dynamically. A reference
  // measurement is never also the measurement being corrected.
  const sources = measurements.filter(
    (m) => localRef?.kind !== "measurement" || m.id !== localRef.id,
  );
  const meas =
    measurements.find((m) => m.id === localMeasId) ||
    sources.find((m) => m.visible) ||
    sources[0] ||
    null;
  const targetCurve =
    allTargets.find((t) => t.id === localTargetId) ||
    allTargets.find((t) => activeTargetIds.includes(t.id)) ||
    allTargets[0] ||
    null;
  const refMeasurement =
    (refMeasId && meas?.id !== refMeasId
      ? measurements.find((m) => m.id === refMeasId)
      : undefined) ?? null;
  const reference: AutoEqReference | null = refMeasurement
    ? { kind: "measurement", id: refMeasurement.id }
    : targetCurve
      ? { kind: "target", id: targetCurve.id }
      : null;
  const target = refMeasurement ?? targetCurve;

  const handleMeasChange = (id: string) => {
    const current = measurements.find((m) => m.id === localMeasId);
    if (id === localMeasId && current?.visible) return;
    invalidateRequest();
    applyMeasurementSelection(id);
  };

  const handleTargetChange = (id: string) => {
    handleReferenceChange(referenceValue({ kind: "target", id }));
  };

  const handleReferenceChange = (value: string) => {
    const next = parseReferenceValue(value);
    if (!next) return;
    if (next.kind === "measurement" && next.id === meas?.id) return;
    // Bail out when the dropdown already shows this reference, so re-picking
    // it cannot invalidate a result or re-hide curves the user turned back on.
    if (
      reference &&
      referenceValue(reference) === value &&
      (next.kind === "measurement"
        ? measurements.some((m) => m.id === next.id && m.visible)
        : activeTargetIds.includes(next.id))
    )
      return;
    invalidateRequest();
    applyReferenceSelection(next);
  };

  const handleRunAutoEq = async () => {
    if (!meas || !target || optimizingRef.current) return;

    const request = ++requestRef.current;
    const context = getAsyncContext();
    const input = {
      measurementName: meas.name,
      measurementPoints: meas.points.map((point) => [point.freq, point.db]),
      targetName: target.name,
      referenceIsMeasurement: reference?.kind === "measurement",
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

      const cleanName = (name: string) =>
        name.replace(/\s*\(.*?\)/g, "").trim() || name;
      const cleanMeasName = cleanName(input.measurementName);
      const cleanTargetName = input.referenceIsMeasurement
        ? cleanName(input.targetName)
        : input.targetName
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
    errorMessage: failure
      ? failure.kind === "busy"
        ? t("autoEq.editorBusy")
        : t("autoEq.couldNotGenerateEQ", { error: failure.error })
      : null,
    meas,
    target,
    reference,
    invalidateRequest,
    handleMeasChange,
    handleTargetChange,
    handleReferenceChange,
    handleRunAutoEq,
  };
}
