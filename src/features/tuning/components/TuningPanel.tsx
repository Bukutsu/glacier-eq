import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { openFileDialog } from "@/lib/rpc";
import { readTextFile } from "@/lib/textFile";
import { FileImportButton } from "@/components/ui/FileImportButton";
import { parseMeasurementText } from "@/features/traces/lib/measurements";
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
  liveApply?: boolean;
  onAddMeasurement?: (
    name: string,
    points: MeasurementTrace["points"],
  ) => string;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => string;
}

export function TuningPanel(props: AutoEqTabProps) {
  return (
    <div className="tuning-panel">
      <AutoEqTab {...props} />
    </div>
  );
}

export function AutoEqTab(props: AutoEqTabProps) {
  const { t } = useTranslation("library");
  const { measurements, allTargets, maxBands = 10, onAddMeasurement } = props;
  const [showAddModal, setShowAddModal] = useState(false);
  const [importingTarget, setImportingTarget] = useState(false);
  const [importError, setImportError] = useState<unknown>(null);
  const focusAfterImport = useRef<string | null>(null);
  const mounted = useRef(true);
  const importing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!showAddModal && focusAfterImport.current) {
      document.getElementById(focusAfterImport.current)?.focus();
      focusAfterImport.current = null;
    }
  });
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
    errorMessage,
    meas,
    target,
    invalidateRequest,
    handleMeasChange,
    handleTargetChange,
    handleRunAutoEq,
  } = useAutoEq(props);
  const importTarget = async (selectedFile?: File) => {
    if (!props.onAddTarget || importing.current) return;
    importing.current = true;
    setImportingTarget(true);
    setImportError(null);
    try {
      const file = selectedFile
        ? await readTextFile(selectedFile)
        : await openFileDialog({
            filters: [
              {
                name: t("addTraceModal.frequencyResponseCsvTxt"),
                extensions: ["csv", "txt"],
              },
            ],
          });
      if (!file || !mounted.current) return;
      const points = parseMeasurementText(file.text);
      const name = file.name.replace(/\.[^/.]+$/, "");
      const id = props.onAddTarget(name, points);
      handleTargetChange(id);
      focusAfterImport.current = "autoeq-target";
      props.setStatus(t("tuningPanel.targetSelected", { name }));
    } catch (error) {
      if (mounted.current) setImportError(error);
    } finally {
      importing.current = false;
      if (mounted.current) setImportingTarget(false);
    }
  };

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

        <fieldset
          className="tuning-fields"
          disabled={isOptimizing || importingTarget}
        >
          <legend className="tuning-sr-only">
            {t("tuningPanel.inputsLegend")}
          </legend>
          <div className="tuning-field">
            <div className="tuning-field-heading">
              {meas ? (
                <label htmlFor="autoeq-measurement">
                  {t("tuningPanel.measurement")}
                </label>
              ) : (
                <span className="tuning-field-label">
                  {t("tuningPanel.measurement")}
                </span>
              )}
              {props.onAddMeasurement && (
                <Button
                  variant="ghost"
                  className="tuning-field-action"
                  disabled={isOptimizing || importingTarget}
                  onClick={() => {
                    setImportError(null);
                    setShowAddModal(true);
                  }}
                >
                  <Icon name="add" /> {t("tuningPanel.addMeasurement")}
                </Button>
              )}
            </div>
            {meas ? (
              <Select
                id="autoeq-measurement"
                value={meas.id}
                options={measurements.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
                onChange={handleMeasChange}
                disabled={isOptimizing || importingTarget}
              />
            ) : (
              <p className="tuning-help">{t("tuningPanel.measurementHelp")}</p>
            )}
          </div>

          <div className="tuning-field">
            <div className="tuning-field-heading">
              <label htmlFor="autoeq-target">
                {t("tuningPanel.targetCurve")}
              </label>
              {props.onAddTarget && (
                <FileImportButton
                  variant="ghost"
                  className="tuning-field-action"
                  disabled={isOptimizing || importingTarget}
                  label={
                    importingTarget
                      ? t("tuningPanel.importingTarget")
                      : t("tuningPanel.importTarget")
                  }
                  accept=".csv,.txt"
                  onImport={importTarget}
                />
              )}
            </div>
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

            {importError != null && (
              <ErrorNotice>
                {t("addTraceModal.couldNotImportFile", { error: importError })}
              </ErrorNotice>
            )}
          </div>
        </fieldset>

        <fieldset
          className="tuning-settings"
          disabled={isOptimizing || importingTarget}
        >
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
              disabled={isOptimizing || importingTarget}
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
          <Collapsible
            title={t("tuningPanel.advancedSettings")}
            defaultOpen={false}
            className="tuning-advanced"
          >
            <div className="tuning-advanced-fields">
              <div className="tuning-field">
                <label htmlFor="autoeq-smoothing">
                  {t("tuningPanel.trebleSmoothing")}
                </label>
                <Select
                  id="autoeq-smoothing"
                  value={smoothType}
                  disabled={isOptimizing || importingTarget}
                  onChange={(value) => {
                    invalidateRequest();
                    setSmoothType(value);
                  }}
                  options={[
                    { value: "IE", label: t("tuningPanel.inEar") },
                    { value: "OE", label: t("tuningPanel.overEar") },
                    { value: "None", label: t("tuningPanel.off") },
                  ]}
                />
              </div>
              <div className="tuning-field">
                <label htmlFor="autoeq-steps">
                  {t("tuningPanel.optimizerSteps")}
                </label>
                <Select
                  id="autoeq-steps"
                  value={steps}
                  disabled={isOptimizing || importingTarget}
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
                  disabled={isOptimizing || importingTarget}
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
            className="tuning-generate w-full"
            aria-describedby={
              nBands <= 5
                ? "tuning-destination tuning-band-warning"
                : "tuning-destination"
            }
            disabled={isOptimizing || importingTarget || !meas || !target}
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
                : props.liveApply
                  ? t("tuningPanel.liveDestinationHelp")
                  : t("tuningPanel.destinationHelp")}
          </p>
        </div>
      </form>
      {showAddModal && onAddMeasurement && (
        <AddTraceModal
          importKind="measurement"
          onClose={() => setShowAddModal(false)}
          onAddMeasurement={(name, points) => {
            const id = onAddMeasurement(name, points);
            handleMeasChange(id);
            focusAfterImport.current = "autoeq-measurement";
          }}
          setStatus={props.setStatus}
        />
      )}
      {errorMessage && (
        <ErrorNotice className="mt-4">{errorMessage}</ErrorNotice>
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
