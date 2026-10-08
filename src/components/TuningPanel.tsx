import { useState } from "react";
import { useAutoEq, type AutoEqOptions } from "../features/tuning/useAutoEq";
import type { MeasurementTrace, TargetTrace } from "../types";
import { AddTraceModal } from "./AddTraceModal";
import { Collapsible } from "./Collapsible";
import { Icon } from "./Icon";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";
import { UnifiedTracesList } from "./UnifiedTraces";

const EMPTY_TARGETS: TargetTrace[] = [];
const EMPTY_TARGET_IDS: string[] = [];

interface AutoEqTabProps extends AutoEqOptions {
  onOpenAddTrace?: () => void;
  onReviewEq?: () => void;
}

interface TuningPanelProps extends AutoEqTabProps {
  onRemoveMeasurement: (id: string) => void;
  onClearMeasurements: () => void;
  onRemoveTarget: (id: string) => void;
  onToggleMeasurement: (id: string) => void;
  onToggleTarget: (id: string) => void;
  onAddMeasurement?: (name: string, points: MeasurementTrace["points"]) => void;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => void;
}

export function TuningPanel(props: TuningPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const openAddTrace = () => setShowAddModal(true);
  const activeTargetIds = props.activeTargetIds ?? EMPTY_TARGET_IDS;
  const visibleCount = props.measurements.filter(trace => trace.visible).length + activeTargetIds.length;

  return (
    <div className="tuning-panel">
      <AutoEqTab {...props} onOpenAddTrace={openAddTrace} />
      <Collapsible
        title={<span className="tuning-compare-title">Compare curves <span>{visibleCount} shown</span></span>}
        icon="analytics"
        defaultOpen={false}
        className="tuning-compare"
      >
        <p className="tuning-help">Show or hide curves on the graph. This does not change the inputs used to generate EQ.</p>
        <div className="tuning-library-actions">
          <button type="button" className="btn" onClick={openAddTrace}>
            <Icon name="add" /> Add measurement or target
          </button>
          {props.measurements.length > 0 && (
            <button type="button" className="btn text danger" onClick={props.onClearMeasurements}>
              Clear measurements
            </button>
          )}
        </div>
        <h3 className="tuning-library-heading">Measurements <span>{props.measurements.length}</span></h3>
        {props.measurements.length === 0
          ? <p className="tuning-help">No measurements added.</p>
          : <UnifiedTracesList {...props} allTargets={EMPTY_TARGETS} activeTargetIds={activeTargetIds} />}
        <h3 className="tuning-library-heading">Targets <span>{props.allTargets.length}</span></h3>
        {props.allTargets.length === 0
          ? <p className="tuning-help">Add a target curve to generate EQ.</p>
          : <UnifiedTracesList {...props} measurements={[]} activeTargetIds={activeTargetIds} />}
      </Collapsible>
      {showAddModal && (
        <AddTraceModal
          onClose={() => setShowAddModal(false)}
          onAddMeasurement={props.onAddMeasurement}
          onAddTarget={props.onAddTarget}
          setStatus={props.setStatus}
        />
      )}
    </div>
  );
}

export function AutoEqTab(props: AutoEqTabProps) {
  const { measurements, allTargets, maxBands = 10, onOpenAddTrace, onReviewEq } = props;
  const {
    nBands, setNBands, steps, setSteps, smoothType, setSmoothType, fs, setFs,
    isOptimizing, warnings, resultMessage, errorMessage, meas, target,
    invalidateRequest, handleMeasChange, handleTargetChange, handleRunAutoEq,
  } = useAutoEq(props);

  return (
    <div className="tuning-match">
      <form className="tuning-form" aria-labelledby="tuning-title" aria-busy={isOptimizing} onSubmit={event => {
        event.preventDefault();
        void handleRunAutoEq();
      }}>
        <header className="tuning-heading">
          <h2 id="tuning-title">Headphone tuning</h2>
          <p>Generate EQ from a measurement and a target curve.</p>
        </header>

        <fieldset className="tuning-step" disabled={isOptimizing}>
          <legend><span className="tuning-step-number" aria-hidden="true">1</span>Measurement</legend>
          <div className="tuning-step-body">
            {meas ? (
              <>
                <label className="tuning-sr-only" htmlFor="autoeq-measurement">Measurement</label>
                <Select id="autoeq-measurement" value={meas.id}
                  options={measurements.map(m => ({ value: m.id, label: m.name }))}
                  onChange={handleMeasChange} disabled={isOptimizing} />
                <div className="tuning-input-meta">
                  <span>{meas.points.length.toLocaleString()} frequency points</span>
                  {onOpenAddTrace && <button type="button" className="btn text tuning-inline-action" onClick={onOpenAddTrace}>Add another</button>}
                </div>
              </>
            ) : (
              <div className="tuning-start">
                <Icon name="analytics" />
                <div>
                  <p>Add a headphone measurement</p>
                  <span>Search the measurement database or import a frequency-response file.</span>
                </div>
                {onOpenAddTrace && <button type="button" className="btn tuning-add" onClick={onOpenAddTrace}>
                  <Icon name="add" /> Add measurement
                </button>}
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="tuning-step" disabled={isOptimizing}>
          <legend><span className="tuning-step-number" aria-hidden="true">2</span>Target curve</legend>
          <div className="tuning-step-body">
            <p className="tuning-help">The desired headphone frequency response.</p>
            <label className="tuning-sr-only" htmlFor="autoeq-target">Target curve</label>
            <Select id="autoeq-target" value={target?.id ?? ""}
              disabled={allTargets.length === 0 || isOptimizing}
              options={allTargets.length > 0
                ? allTargets.map(t => ({ value: t.id, label: t.name }))
                : [{ value: "", label: "Add a target to continue" }]}
              onChange={handleTargetChange} />
            {!target && onOpenAddTrace && <button type="button" className="btn tuning-add" onClick={onOpenAddTrace}>
              <Icon name="add" /> Add target
            </button>}
          </div>
        </fieldset>

        <fieldset className="tuning-step" disabled={isOptimizing}>
          <legend><span className="tuning-step-number" aria-hidden="true">3</span>Generate EQ</legend>
          <div className="tuning-step-body">
            <div className="tuning-band-row">
              <div>
                <label htmlFor="autoeq-bands">Filter bands</label>
                <p className="tuning-help">Maximum: {Math.max(1, maxBands)} bands.</p>
              </div>
              <NumberInput id="autoeq-bands" aria-label="Filter bands" disabled={isOptimizing}
                value={nBands} min={1} max={Math.max(1, maxBands)}
                onChange={value => { invalidateRequest(); setNBands(value); }}
                className="tuning-bands" />
            </div>
            <div className="tuning-smoothing">
              <span id="tuning-smoothing-label">Treble smoothing</span>
              <div className="tuning-segmented" role="group" aria-labelledby="tuning-smoothing-label">
                {[{ value: "IE", label: "In-ear" }, { value: "OE", label: "Over-ear" }, { value: "None", label: "Off" }].map(option => (
                  <button key={option.value} type="button" aria-pressed={smoothType === option.value}
                    className={smoothType === option.value ? "active" : ""}
                    onClick={() => { invalidateRequest(); setSmoothType(option.value); }}>
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="tuning-help">Select the headphone type to smooth sharp treble peaks.</p>
            </div>
            <Collapsible
              title={<span className="tuning-advanced-title">
                <span>Advanced settings</span>{" "}
                <span className="tuning-advanced-summary">{steps.toLocaleString()} steps at {fs / 1000} kHz</span>
              </span>}
              icon="tune"
              defaultOpen={false}
              className="tuning-advanced"
            >
              <div className="tuning-advanced-fields">
                <div className="tuning-advanced-field">
                  <div>
                    <label htmlFor="autoeq-steps">Optimizer steps</label>
                    <p className="tuning-help">Additional steps increase calculation time.</p>
                  </div>
                  <Select id="autoeq-steps" value={steps} disabled={isOptimizing}
                    onChange={value => { invalidateRequest(); setSteps(value); }}
                    options={[
                      { value: 500, label: "500 (fast)" }, { value: 1000, label: "1,000" },
                      { value: 2000, label: "2,000 (standard)" }, { value: 3000, label: "3,000" },
                      { value: 5000, label: "5,000 (extended)" },
                    ]} />
                </div>
                <div className="tuning-advanced-field">
                  <div>
                    <label htmlFor="autoeq-fs">Sample rate</label>
                    <p className="tuning-help">Use the DAC’s DSP sample rate.</p>
                  </div>
                  <Select id="autoeq-fs" value={fs} disabled={isOptimizing}
                    onChange={value => { invalidateRequest(); setFs(value); }}
                    options={[
                      { value: 44100, label: "44.1 kHz" }, { value: 48000, label: "48 kHz" },
                      { value: 96000, label: "96 kHz" },
                    ]} />
                </div>
              </div>
            </Collapsible>
            <button type="submit" className="btn filled tuning-generate" disabled={isOptimizing || !meas || !target}>
              <Icon name={isOptimizing ? "hourglass_empty" : "auto_awesome"} />
              {isOptimizing ? "Generating EQ…" : "Generate EQ"}
            </button>
            <p className="tuning-help tuning-destination">
              {!meas ? "Add a measurement to continue." : !target ? "Add a target to continue." : "Generated EQ is loaded into the editor. The DAC is not changed."}
            </p>
          </div>
        </fieldset>
      </form>
      <div className="tuning-result" role="status" aria-live="polite" aria-atomic="true">
        {resultMessage && (
          <div className="tuning-result-content">
            <Icon name="info" />
            <div><strong>EQ generated</strong><p>{resultMessage}</p>
              {onReviewEq && <button type="button" className="btn" onClick={onReviewEq}>Review EQ</button>}
            </div>
          </div>
        )}
      </div>
      {errorMessage && <p className="tuning-error" role="alert">{errorMessage}</p>}
      {warnings.length > 0 && (
        <div className="tuning-warnings"><strong>Review before applying</strong>
          <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
