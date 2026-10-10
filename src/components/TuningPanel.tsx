import { useState } from "react";
import { useAutoEq, type AutoEqOptions } from "../features/tuning/useAutoEq";
import type { MeasurementTrace, TargetTrace } from "../types";
import { AddTraceModal } from "./AddTraceModal";
import { Collapsible } from "./Collapsible";
import { Icon } from "./Icon";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";
import { UnifiedTracesList } from "./UnifiedTraces";
import { Button } from "./ui/Button";

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
        defaultOpen={false}
        className="tuning-compare"
      >
        <p className="tuning-help">Show curves on the graph without changing the EQ inputs.</p>
        <div className="tuning-library-actions">
          <Button variant="ghost" onClick={openAddTrace}>
            <Icon name="add" /> Add curve
          </Button>
          {props.measurements.length > 0 && (
            <Button variant="ghost" className="tuning-clear" onClick={props.onClearMeasurements}>
              Clear measurements
            </Button>
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
          <p>Match a measurement to a target curve.</p>
        </header>

        <fieldset className="tuning-fields" disabled={isOptimizing}>
          <legend className="tuning-sr-only">EQ inputs</legend>
          <div className="tuning-field">
            <div className="tuning-field-heading">
              {meas ? <label htmlFor="autoeq-measurement">Measurement</label> : <span>Measurement</span>}
              {meas && onOpenAddTrace && (
                <Button variant="ghost" disabled={isOptimizing} onClick={onOpenAddTrace}>
                  <Icon name="add" /> Add another
                </Button>
              )}
            </div>
            {meas ? (
              <Select id="autoeq-measurement" value={meas.id}
                options={measurements.map(m => ({ value: m.id, label: m.name }))}
                onChange={handleMeasChange} disabled={isOptimizing} />
            ) : (
              <>
                {onOpenAddTrace && (
                  <Button disabled={isOptimizing} className="w-full min-h-11" onClick={onOpenAddTrace}>
                    <Icon name="add" /> Add measurement
                  </Button>
                )}
                <p className="tuning-help">Search the database or import a frequency-response file.</p>
              </>
            )}
          </div>

          <div className="tuning-field">
            <label htmlFor="autoeq-target">Target curve</label>
            <Select id="autoeq-target" value={target?.id ?? ""}
              disabled={allTargets.length === 0 || isOptimizing}
              options={allTargets.length > 0
                ? allTargets.map(t => ({ value: t.id, label: t.name }))
                : [{ value: "", label: "Add a target to continue" }]}
              onChange={handleTargetChange} />
            {!target && onOpenAddTrace && (
              <Button disabled={isOptimizing} onClick={onOpenAddTrace}>
                <Icon name="add" /> Add target
              </Button>
            )}
          </div>
        </fieldset>

        <fieldset className="tuning-settings" disabled={isOptimizing}>
          <legend className="tuning-sr-only">EQ settings</legend>
          <div className="tuning-band-row">
            <div>
              <label htmlFor="autoeq-bands">Filter bands</label>
              <p className="tuning-help">Up to {Math.max(1, maxBands)} bands</p>
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
                <Button key={option.value} aria-pressed={smoothType === option.value}
                  variant={smoothType === option.value ? "default" : "ghost"}
                  disabled={isOptimizing}
                  onClick={() => { invalidateRequest(); setSmoothType(option.value); }}>
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <Collapsible title="Advanced settings" defaultOpen={false} className="tuning-advanced">
            <div className="tuning-advanced-fields">
              <div className="tuning-field">
                <label htmlFor="autoeq-steps">Optimizer steps</label>
                <Select id="autoeq-steps" value={steps} disabled={isOptimizing}
                  onChange={value => { invalidateRequest(); setSteps(value); }}
                  options={[
                    { value: 500, label: "500 (fast)" }, { value: 1000, label: "1,000" },
                    { value: 2000, label: "2,000 (standard)" }, { value: 3000, label: "3,000" },
                    { value: 5000, label: "5,000 (extended)" },
                  ]} />
                <p className="tuning-help">More steps take longer to calculate.</p>
              </div>
              <div className="tuning-field">
                <label htmlFor="autoeq-fs">Sample rate</label>
                <Select id="autoeq-fs" value={fs} disabled={isOptimizing}
                  onChange={value => { invalidateRequest(); setFs(value); }}
                  options={[
                    { value: 44100, label: "44.1 kHz" }, { value: 48000, label: "48 kHz" },
                    { value: 96000, label: "96 kHz" },
                  ]} />
                <p className="tuning-help">Use the DAC's DSP sample rate.</p>
              </div>
            </div>
          </Collapsible>
        </fieldset>

        <div className="tuning-submit">
          <Button type="submit" variant="primary" className="tuning-generate w-full min-h-11"
            aria-describedby="tuning-destination" disabled={isOptimizing || !meas || !target}>
            {isOptimizing && <Icon name="hourglass_empty" />}
            {isOptimizing ? "Generating EQ…" : "Generate EQ"}
          </Button>
          <p id="tuning-destination" className="tuning-help tuning-destination">
            {!meas ? "Add a measurement to generate EQ." : !target ? "Add a target to generate EQ." : "Loads EQ into the editor, not the DAC."}
          </p>
        </div>
      </form>
      <div className="tuning-result" role="status" aria-live="polite" aria-atomic="true">
        {resultMessage && (
          <div className="tuning-result-content">
            <Icon name="check" />
            <div><strong>EQ generated</strong><p>{resultMessage}</p>
              {onReviewEq && <Button onClick={onReviewEq}>Review EQ</Button>}
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
