import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { openFileDialog } from "@/lib/rpc";
import { readTextFile } from "@/lib/textFile";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { FileImportButton } from "@/components/ui/FileImportButton";
import { parseMeasurementText } from "@/features/traces/lib/measurements";
import {
  referenceValue,
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
    <div className="tuning-panel leg:flex leg:flex-col leg:min-w-[0] leg:compact:p-[var(--space-4)]">
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
    reference,
    invalidateRequest,
    handleMeasChange,
    handleTargetChange,
    handleReferenceChange,
    handleRunAutoEq,
  } = useAutoEq(props);
  // Another headphone's measurement can be the reference: match its sound.
  const referenceOptions = [
    ...allTargets.map((curve) => ({
      value: referenceValue({ kind: "target", id: curve.id }),
      label: curve.name,
    })),
    ...measurements
      .filter((m) => m.id !== meas?.id)
      .map((m) => ({
        value: referenceValue({ kind: "measurement", id: m.id }),
        label: t("tuningPanel.measurementReference", { name: m.name }),
      })),
  ];
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
    <div className="leg:flex leg:flex-col leg:min-w-[0]">
      <form
        className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-4)] cmp:compact:[.mobile-workspace_&]:gap-[var(--space-3)]"
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
          className="leg:flex leg:flex-col leg:min-w-[0] leg:m-[0] leg:p-[0] leg:[border:0] leg:gap-[var(--space-4)]"
          disabled={isOptimizing || importingTarget}
        >
          <legend className="leg:absolute leg:w-[1px] leg:h-[1px] leg:p-[0] leg:m-[-1px] leg:overflow-hidden leg:[clip-path:inset(50%)] leg:whitespace-nowrap leg:[border:0]">
            {t("tuningPanel.inputsLegend")}
          </legend>
          <div className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-2)]">
            <div className="tuning-field-heading leg:flex leg:items-center leg:justify-between leg:gap-[var(--space-3)] leg:min-w-[0]">
              {meas ? (
                <label htmlFor="autoeq-measurement">
                  {t("tuningPanel.measurement")}
                </label>
              ) : (
                <span className="leg:text-[color:var(--foreground)] leg:text-[length:var(--type-label)] leg:font-medium leg:leading-[1.5]">
                  {t("tuningPanel.measurement")}
                </span>
              )}
              {props.onAddMeasurement && (
                <Button
                  variant="ghost"
                  className="tuning-field-action leg:[.tuning-panel_&]:h-[auto] leg:[.tuning-panel_&]:min-h-[28px] leg:[.tuning-panel_&]:max-w-[65%] leg:[.tuning-panel_&]:p-[var(--space-1)_var(--space-2)] leg:[.tuning-panel_&]:text-[length:var(--type-small)] leg:[.tuning-panel_&]:leading-[1.4] leg:[.tuning-panel_&]:whitespace-normal leg:[.tuning-panel_&]:text-end"
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
              <p className="leg:m-[0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5]">{t("tuningPanel.measurementHelp")}</p>
            )}
          </div>

          <div className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-2)]">
            <div className="tuning-field-heading leg:flex leg:items-center leg:justify-between leg:gap-[var(--space-3)] leg:min-w-[0]">
              <label htmlFor="autoeq-target">
                {t("tuningPanel.targetCurve")}
              </label>
              {props.onAddTarget && (
                <FileImportButton
                  variant="ghost"
                  className="tuning-field-action leg:[.tuning-panel_&]:h-[auto] leg:[.tuning-panel_&]:min-h-[28px] leg:[.tuning-panel_&]:max-w-[65%] leg:[.tuning-panel_&]:p-[var(--space-1)_var(--space-2)] leg:[.tuning-panel_&]:text-[length:var(--type-small)] leg:[.tuning-panel_&]:leading-[1.4] leg:[.tuning-panel_&]:whitespace-normal leg:[.tuning-panel_&]:text-end"
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
            <SearchSelect
              id="autoeq-target"
              value={reference ? referenceValue(reference) : ""}
              disabled={referenceOptions.length === 0 || isOptimizing}
              options={
                referenceOptions.length > 0
                  ? referenceOptions
                  : [
                      {
                        value: "",
                        label: t("tuningPanel.addATargetToContinue"),
                      },
                    ]
              }
              onChange={handleReferenceChange}
              searchLabel={t("tuningPanel.targetCurve")}
              searchPlaceholder={t("tuningPanel.searchReferences")}
              emptyText={t("tuningPanel.noReferenceMatches")}
            />

            {importError != null && (
              <ErrorNotice>
                {t("addTraceModal.couldNotImportFile", { error: importError })}
              </ErrorNotice>
            )}
          </div>
        </fieldset>

        <fieldset
          className="leg:flex leg:flex-col leg:min-w-[0] leg:m-[0] leg:p-[0] leg:[border:0] leg:[&&]:pt-[var(--space-4)] leg:[&&]:[border-top:1px_solid_var(--line-soft)] leg:gap-[var(--space-2)] cmp:compact:[.mobile-workspace_&]:gap-[var(--space-3)] cmp:compact:[.mobile-workspace_&]:pt-[var(--space-3)]"
          disabled={isOptimizing || importingTarget}
        >
          <legend className="leg:absolute leg:w-[1px] leg:h-[1px] leg:p-[0] leg:m-[-1px] leg:overflow-hidden leg:[clip-path:inset(50%)] leg:whitespace-nowrap leg:[border:0]">
            {t("tuningPanel.settingsLegend")}
          </legend>
          <div className="leg:flex leg:items-center leg:justify-between leg:gap-[var(--space-3)] leg:min-w-[0]">
            <div>
              <label htmlFor="autoeq-bands">
                {t("tuningPanel.filterBands")}
              </label>
              <p className="leg:m-[0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5]">
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
              className="leg:[.tuning-panel_&]:w-[112px] leg:[.tuning-panel_&]:flex-[0_0_auto] leg:compact:[.tuning-panel_&&]:w-[144px]"
            />
          </div>
          {nBands <= 5 && (
            <div
              id="tuning-band-warning"
              className="tuning-warnings leg:m-[var(--space-3)_0_0] leg:p-[var(--space-3)] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--control-radius)] leg:[background:transparent] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:[overflow-wrap:anywhere]"
              role="note"
            >
              <strong>{t("tuningPanel.limitedBandAutoEQ")}</strong>
              <p>{t("tuningPanel.limitedBandsWarning")}</p>
            </div>
          )}
          <Collapsible
            title={t("tuningPanel.advancedSettings")}
            defaultOpen={false}
            className="tuning-advanced leg:[.tuning-panel_&]:[border:0] leg:[.tuning-panel_&]:rounded-[0] leg:[.tuning-panel_&]:[background:transparent] leg:[.tuning-panel_&]:overflow-visible"
          >
            <div className="leg:flex leg:flex-col leg:gap-[var(--space-4)]">
              <div className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-2)]">
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
              <div className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-2)]">
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
                <p className="leg:m-[0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5]">{t("tuningPanel.stepsHelp")}</p>
              </div>
              <div className="leg:flex leg:flex-col leg:min-w-[0] leg:gap-[var(--space-2)]">
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
                <p className="leg:m-[0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5]">{t("tuningPanel.sampleRateHelp")}</p>
              </div>
            </div>
          </Collapsible>
        </fieldset>

        <div className="leg:flex leg:flex-col leg:gap-[var(--space-2)] cmp:compact:[.mobile-workspace_&]:sticky cmp:compact:[.mobile-workspace_&]:bottom-[0] cmp:compact:[.mobile-workspace_&]:z-[var(--z-sticky)] cmp:compact:[.mobile-workspace_&]:p-[var(--space-2)_0] cmp:compact:[.mobile-workspace_&]:[background:var(--bg)] cmp:compact:[.mobile-workspace_&]:[border-top:1px_solid_var(--border)] cmp:compact:[.mobile-workspace.has-save-bar_&]:bottom-[60px] cmp:compact:[.keyboard-open_&&]:bottom-[var(--space-2)]">
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
          <p id="tuning-destination" className="leg:m-[0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5] tuning-destination">
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
        <div className="tuning-warnings leg:m-[var(--space-3)_0_0] leg:p-[var(--space-3)] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--control-radius)] leg:[background:transparent] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:[overflow-wrap:anywhere]">
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
