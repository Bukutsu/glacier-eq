import { useEffect, useRef, useState } from "react";
import { invoke } from "../../lib/rpc";
import { asyncContextEquals, type AsyncContext } from "../../lib/asyncContext";
import { parseAutoEqResult } from "../../lib/parsedAutoEq";
import type { MeasurementTrace, PEQData, TargetTrace } from "../../types";

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
  maxBands = 10,
  dspSampleRate = 96000,
  getAsyncContext,
}: AutoEqOptions) {
  const [nBands, setNBands] = useState<number>(Math.max(1, maxBands));
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(dspSampleRate);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestRef = useRef(0);
  const optimizingRef = useRef(false);
  const mountedRef = useRef(true);

  const invalidateRequest = () => {
    requestRef.current += 1;
    optimizingRef.current = false;
    setIsOptimizing(false);
    setResultMessage(null);
    setWarnings([]);
    setErrorMessage(null);
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
    setResultMessage(null);
    setWarnings([]);
    setErrorMessage(null);
    if (superseded) setStatus("EQ generation cancelled because the inputs changed.");
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

  // Sync default measurement selection
  useEffect(() => {
    if (localMeasId && measurements.some((m) => m.id === localMeasId)) {
      return;
    }
    const visible = measurements.find((m) => m.visible);
    if (visible) {
      setLocalMeasId(visible.id);
    } else if (measurements.length > 0) {
      setLocalMeasId(measurements[0].id);
    } else {
      setLocalMeasId("");
    }
  }, [measurements, localMeasId]);

  // Sync default target selection
  useEffect(() => {
    if (localTargetId && allTargets.some((t) => t.id === localTargetId)) {
      return;
    }
    const active = allTargets.find((t) => activeTargetIds.includes(t.id));
    if (active) {
      setLocalTargetId(active.id);
    } else if (allTargets.length > 0) {
      setLocalTargetId(allTargets[0].id);
    } else {
      setLocalTargetId("");
    }
  }, [allTargets, activeTargetIds, localTargetId]);

  // Sync selected measurement to parent for graph highlighting
  useEffect(() => {
    onSelectedMeasurementChange?.(localMeasId || null);
  }, [onSelectedMeasurementChange, localMeasId]);

  // Resolve measurement and target objects dynamically
  const meas = measurements.find((m) => m.id === localMeasId) || measurements.find((m) => m.visible) || measurements[0] || null;
  const target = allTargets.find((t) => t.id === localTargetId) || allTargets.find((t) => activeTargetIds.includes(t.id)) || allTargets[0] || null;

  const handleMeasChange = (id: string) => {
    invalidateRequest();
    setLocalMeasId(id);
    const m = measurements.find((x) => x.id === id);
    if (m) {
      if (!m.visible) {
        onToggleMeasurement?.(id);
      }
      onSelectedMeasurementChange?.(id);
    }
  };

  const handleTargetChange = (id: string) => {
    invalidateRequest();
    setLocalTargetId(id);
    // Reveal the chosen input without hiding curves the user is comparing.
    if (!activeTargetIds.includes(id)) {
      onToggleTarget?.(id);
    }
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
    const isCurrent = () => mountedRef.current
      && request === requestRef.current
      && asyncContextEquals(context, getAsyncContext());

    optimizingRef.current = true;
    setIsOptimizing(true);
    setResultMessage(null);
    setStatus("Generating EQ…");
    setWarnings([]);
    setErrorMessage(null);

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

      const cleanMeasName = input.measurementName
        .replace(/\s*\(.*?\)/g, "")
        .trim() || input.measurementName;
      const cleanTargetName = input.targetName
        .replace(/IE 2019/i, "IE")
        .replace(/OE 2018/i, "OE")
        .replace(/Preference \d+/i, "Pref")
        .replace(/PEQdb /i, "")
        .replace(/Reference/i, "")
        .trim() || input.targetName;
      const autoName = `${cleanMeasName} @ ${cleanTargetName}`;
      const applied = onImportPEQ(result.peq, autoName, false);
      if (!applied) {
        const message = "EQ was not loaded because a device operation is in progress. Wait for it to finish, then generate EQ again.";
        setErrorMessage(message);
        setStatus(message);
        return;
      }
      setWarnings(result.warnings);
      setResultMessage("EQ loaded into the editor. Review it before saving a profile or writing it to the DAC.");

      if (result.warnings.length > 0) {
        setStatus(`EQ generated with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`);
      } else {
        setStatus("EQ generated");
      }
    } catch (err) {
      if (isCurrent()) {
        const message = `Could not generate EQ: ${err}`;
        setErrorMessage(message);
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
    nBands, setNBands, steps, setSteps, smoothType, setSmoothType, fs, setFs,
    isOptimizing, warnings, resultMessage, errorMessage, meas, target,
    invalidateRequest, handleMeasChange, handleTargetChange, handleRunAutoEq,
  };
}
