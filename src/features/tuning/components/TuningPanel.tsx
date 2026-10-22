import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import {
  useAutoEq,
  type AutoEqOptions,
} from "@/features/tuning/hooks/useAutoEq";
import type { MeasurementTrace } from "@/types";
import { AddTraceModal } from "@/features/traces/components/AddTraceModal";
import { Collapsible } from "@/components/ui/Collapsible";
import { Icon } from "@/components/ui/Icon";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

interface AutoEqTabProps extends AutoEqOptions {
  onOpenAddTrace?: () => void;
  onReviewEq?: () => void;
}

interface TuningPanelProps extends AutoEqTabProps {
  onAddMeasurement?: (name: string, points: MeasurementTrace["points"]) => void;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => void;
}

export function TuningPanel(props: TuningPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const openAddTrace = () => setShowAddModal(true);

  return (
    <div className="tuning-panel">
      <AutoEqTab {...props} onOpenAddTrace={openAddTrace} />
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
  const { t } = useTranslation("library");
  const {
    measurements,
    allTargets,
    maxBands = 10,
    onOpenAddTrace,
    onReviewEq,
  } = props;
  const {
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
    resultMessage,
    errorMessage,
    meas,
    target,
    invalidateRequest,
    handleMeasChange,
    handleTargetChange,
    handleRunAutoEq,
  } = useAutoEq(props);
  const resultRef = useRef<HTMLDivElement>(null);

  // On a phone the result lands below the sticky Generate button; bring the
  // next step into view instead of leaving it off-screen.
  useEffect(() => {
    if (!resultMessage) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    resultRef.current?.scrollIntoView?.({
      block: "center",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [resultMessage]);

  return (
    <div className="tuning-match">
      <form
        className="tuning-form"
        aria-labelledby="tuning-title"
        aria-busy={isOptimizing}
        onSubmit={(event) => {
          event.preventDefault();
          void handleRunAutoEq();
        }}
      >
        <header className="tuning-heading">
          <h2 id="tuning-title">{t("tuningPanel.headphoneTuning")}</h2>
          <p>{t("tuningPanel.description")}</p>
        </header>

        <fieldset className="tuning-fields" disabled={isOptimizing}>
          <legend className="tuning-sr-only">
            {t("tuningPanel.inputsLegend")}
          </legend>
          <div className="tuning-field">
            {meas ? (
              <label htmlFor="autoeq-measurement">
                {t("tuningPanel.measurement")}
              </label>
            ) : (
              <span className="tuning-field-label">
                {t("tuningPanel.measurement")}
              </span>
            )}
            {meas ? (
              <Select
                id="autoeq-measurement"
                value={meas.id}
                options={measurements.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
                onChange={handleMeasChange}
                disabled={isOptimizing}
              />
            ) : (
              <p className="tuning-help">{t("tuningPanel.measurementHelp")}</p>
            )}
          </div>

          <div className="tuning-field">
            <label htmlFor="autoeq-target">
              {t("tuningPanel.targetCurve")}
            </label>
            <Select
              id="autoeq-target"
              value={target?.id ?? ""}
              disabled={allTargets.length === 0 || isOptimizing}
              options={
                allTargets.length > 0
                  ? allTargets.map((t) => ({ value: t.id, label: t.name }))
                  : [
                      {
                        value: "",
                        label: t("tuningPanel.addATargetToContinue"),
                      },
                    ]
              }
              onChange={handleTargetChange}
            />
          </div>
          {onOpenAddTrace && (
            <Button
              className="w-full min-h-11"
              disabled={isOptimizing}
              onClick={onOpenAddTrace}
            >
              <Icon name="add" /> {t("tuningPanel.addMeasurementOrTarget")}
            </Button>
          )}
        </fieldset>

        <fieldset className="tuning-settings" disabled={isOptimizing}>
          <legend className="tuning-sr-only">
            {t("tuningPanel.settingsLegend")}
          </legend>
          <div className="tuning-band-row">
            <div>
              <label htmlFor="autoeq-bands">
                {t("tuningPanel.filterBands")}
              </label>
              <p className="tuning-help">
                {t("tuningPanel.bandLimit", { count: Math.max(1, maxBands) })}
              </p>
            </div>
            <NumberInput
              id="autoeq-bands"
              aria-label={t("tuningPanel.filterBands")}
              disabled={isOptimizing}
              value={nBands}
              min={1}
              max={Math.max(1, maxBands)}
              onChange={(value) => {
                invalidateRequest();
                setNBands(value);
              }}
              className="tuning-bands"
            />
          </div>
          {nBands <= 5 && (
            <div
              id="tuning-band-warning"
              className="tuning-warnings"
              role="note"
            >
              <strong>{t("tuningPanel.limitedBandAutoEQ")}</strong>
              <p>{t("tuningPanel.limitedBandsWarning")}</p>
            </div>
          )}
          <div className="tuning-smoothing">
            <span id="tuning-smoothing-label">
              {t("tuningPanel.trebleSmoothing")}
            </span>
            <div
              className="tuning-segmented"
              role="group"
              aria-labelledby="tuning-smoothing-label"
            >
              {[
                { value: "IE", label: t("tuningPanel.inEar") },
                { value: "OE", label: t("tuningPanel.overEar") },
                { value: "None", label: t("tuningPanel.off") },
              ].map((option) => (
                <Button
                  key={option.value}
                  aria-pressed={smoothType === option.value}
                  variant={smoothType === option.value ? "default" : "ghost"}
                  disabled={isOptimizing}
                  onClick={() => {
                    invalidateRequest();
                    setSmoothType(option.value);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <Collapsible
            title={t("tuningPanel.advancedSettings")}
            defaultOpen={false}
            className="tuning-advanced"
          >
            <div className="tuning-advanced-fields">
              <div className="tuning-field">
                <label htmlFor="autoeq-steps">
                  {t("tuningPanel.optimizerSteps")}
                </label>
                <Select
                  id="autoeq-steps"
                  value={steps}
                  disabled={isOptimizing}
                  onChange={(value) => {
                    invalidateRequest();
                    setSteps(value);
                  }}
                  options={[
                    { value: 500, label: t("tuningPanel.fastSteps") },
                    { value: 1000, label: t("tuningPanel.thousandSteps") },
                    { value: 2000, label: t("tuningPanel.standardSteps") },
                    { value: 3000, label: t("tuningPanel.threeThousandSteps") },
                    { value: 5000, label: t("tuningPanel.extendedSteps") },
                  ]}
                />
                <p className="tuning-help">{t("tuningPanel.stepsHelp")}</p>
              </div>
              <div className="tuning-field">
                <label htmlFor="autoeq-fs">{t("tuningPanel.sampleRate")}</label>
                <Select
                  id="autoeq-fs"
                  value={fs}
                  disabled={isOptimizing}
                  onChange={(value) => {
                    invalidateRequest();
                    setFs(value);
                  }}
                  options={[
                    { value: 44100, label: t("tuningPanel.sampleRate44100") },
                    { value: 48000, label: t("tuningPanel.sampleRate48000") },
                    { value: 96000, label: t("tuningPanel.sampleRate96000") },
                  ]}
                />
                <p className="tuning-help">{t("tuningPanel.sampleRateHelp")}</p>
              </div>
            </div>
          </Collapsible>
        </fieldset>

        <div className="tuning-submit">
          <Button
            type="submit"
            variant="primary"
            className="tuning-generate w-full min-h-11"
            aria-describedby={
              nBands <= 5
                ? "tuning-destination tuning-band-warning"
                : "tuning-destination"
            }
            disabled={isOptimizing || !meas || !target}
          >
            {isOptimizing && <Icon name="hourglass_empty" />}
            {isOptimizing
              ? t("tuningPanel.generatingEQ")
              : t("tuningPanel.generateEQ")}
          </Button>
          <p id="tuning-destination" className="tuning-help tuning-destination">
            {!meas
              ? t("tuningPanel.needsMeasurement")
              : !target
                ? t("tuningPanel.needsTarget")
                : t("tuningPanel.destinationHelp")}
          </p>
        </div>
      </form>
      <div
        ref={resultRef}
        className="tuning-result"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {resultMessage && (
          <div className="tuning-result-content">
            <Icon name="check" />
            <div>
              <strong>{t("tuningPanel.generated")}</strong>
              <p>{resultMessage}</p>
              {onReviewEq && (
                <Button onClick={onReviewEq}>
                  {t("tuningPanel.reviewEQ")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      {errorMessage && (
        <p className="tuning-error" role="alert">
          {errorMessage}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="tuning-warnings">
          <strong>{t("tuningPanel.reviewBeforeApplying")}</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
