import { i18n } from "@/lib/i18n";
import type { invoke, sleep } from "@/lib/rpc";
import type { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  writeDevDummyPeq,
  isDevDummyDevice,
} from "@/features/device/lib/devDevice";
import {
  extractPushWarnings,
  normalizePeq,
  parseStoredPeqResponse,
} from "@/features/eq/lib/peq";

import { isDisconnectionError } from "@/lib/errors";
import { asyncContextEquals } from "@/lib/asyncContext";

import type { Profile } from "@/types";

import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import type { ReportStatus } from "@/features/diagnostics/types";

export type ApplyProfileToRamContext = Pick<
  DeviceState,
  | "manualDisconnectRef"
  | "selectedDevice"
  | "connectedPathRef"
  | "connectedSessionIdRef"
  | "connectionGenerationRef"
  | "operationRevisionRef"
  | "setConnected"
  | "setIsReconnecting"
  | "setFirmwareVersion"
  | "setIsBusy"
  | "setProgress"
  | "eqOperationInFlightRef"
  | "eqOperationIdRef"
  | "setLastPushedPeq"
  | "capabilities"
> &
  Pick<
    EqEditor,
    | "setPeq"
    | "dirty"
    | "setDirty"
    | "peqRef"
    | "editorCleanPeqRef"
    | "noteEditorMutation"
    | "pushToUndoStack"
    | "setSelectedPreset"
    | "setProfileSearch"
    | "setNewProfileName"
    | "getAsyncContext"
  > & {
    reportStatus: ReportStatus;
    reportLoss: ReportStatus;
    recoverDeviceRead: (path: string, error: unknown) => Promise<boolean>;
    invoke: typeof invoke;
    sleep: typeof sleep;
    confirmDialog: typeof confirmDialog;
  };

export function createApplyProfileToRam(context: ApplyProfileToRamContext) {
  const {
    manualDisconnectRef,
    selectedDevice,
    connectedPathRef,
    connectedSessionIdRef,
    connectionGenerationRef,
    operationRevisionRef,
    setConnected,
    setIsReconnecting,
    setFirmwareVersion,
    setIsBusy,
    setProgress,
    eqOperationInFlightRef,
    eqOperationIdRef,
    setLastPushedPeq,
    capabilities,
    setPeq,
    dirty,
    setDirty,
    peqRef,
    editorCleanPeqRef,
    noteEditorMutation,
    pushToUndoStack,
    setSelectedPreset,
    setProfileSearch,
    setNewProfileName,
    getAsyncContext,
    reportStatus,
    reportLoss,
    recoverDeviceRead,
    invoke,
    sleep,
    confirmDialog,
  } = context;
  return async (profile: Profile) => {
    if (eqOperationInFlightRef.current) return;
    operationRevisionRef.current += 1;
    const confirmationContext = getAsyncContext();
    const confirmationPath = connectedPathRef.current;
    const confirmationSessionId = connectedSessionIdRef.current;
    const confirmationGeneration = connectionGenerationRef.current;
    const confirmationCapabilities = capabilities;
    const isConfirmationCurrent = () =>
      asyncContextEquals(confirmationContext, getAsyncContext()) &&
      connectionGenerationRef.current === confirmationGeneration &&
      connectedPathRef.current === confirmationPath &&
      connectedSessionIdRef.current === confirmationSessionId &&
      capabilities === confirmationCapabilities;
    if (
      dirty &&
      !(await confirmDialog({
        title: i18n.t("device:applyProfileToRam.discardChanges"),
        message: i18n.t("device:applyProfileToRam.discardConfirmation"),
        confirmLabel: i18n.t("device:applyProfileToRam.discardAndApply"),
      }))
    )
      return;
    if (!isConfirmationCurrent()) return;
    eqOperationInFlightRef.current = true;
    const data = normalizePeq(profile.data, {
      enableLoadedFilters: true,
      integerPreamp: capabilities.integer_preamp,
      capabilities,
    });
    setProgress(null);
    setIsBusy(true);
    const operationId = ++eqOperationIdRef.current;
    const isCurrentOperation = () =>
      operationId === eqOperationIdRef.current &&
      connectionGenerationRef.current === confirmationGeneration &&
      connectedPathRef.current === confirmationPath &&
      connectedSessionIdRef.current === confirmationSessionId &&
      capabilities === confirmationCapabilities &&
      getAsyncContext().connectionRevision ===
        confirmationContext.connectionRevision &&
      getAsyncContext().operationRevision ===
        confirmationContext.operationRevision;
    let applyWarnings: string[] = [];
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({
          message: i18n.t("device:applyProfileToRam.applyingTemporaryEq"),
          percentage: 60,
        });
        await sleep(250);
        setProgress({
          message: i18n.t("device:applyProfileToRam.temporaryEqApplied"),
          percentage: 100,
        });
        await sleep(300);
      } else {
        // apply_eq_state returns the normalized state written to RAM, plus
        // any capability-clamp warnings from normalization.
        const outcome = await invoke<unknown>("apply_eq_state", { peq: data });
        applyWarnings = extractPushWarnings(outcome);
        const applied = parseStoredPeqResponse(outcome, {
          integerPreamp: capabilities.integer_preamp,
          capabilities,
        });
        await sleep(300);
        if (!isCurrentOperation()) return;
        setLastPushedPeq(applied);
      }
      if (!isCurrentOperation()) return;
      // Commit to the editor only once the DAC holds the profile, so a failed
      // write leaves the editor (and its unsaved edits) untouched.
      pushToUndoStack(peqRef.current);
      setPeq(data);
      noteEditorMutation();
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
      editorCleanPeqRef.current = data;
      setDirty(false);
      if (isDevDummyDevice(selectedDevice)) {
        setLastPushedPeq(writeDevDummyPeq(selectedDevice, data, false));
      }
      const appliedMessage = isDevDummyDevice(selectedDevice)
        ? i18n.t("device:applyProfileToRam.simulated")
        : i18n.t("device:applyProfileToRam.appliedProfile", {
            name: profile.name,
          });
      if (applyWarnings.length > 0) {
        reportStatus({
          level: "Warn",
          message: i18n.t("device:applyProfileToRam.completionWarnings", {
            message: appliedMessage,
            warnings: applyWarnings.join(" · "),
          }),
          toastType: "info",
          source: "UI",
          statusText: i18n.t(
            "device:applyProfileToRam.valuesAdjustedToDeviceLimits",
            { appliedMessage: appliedMessage },
          ),
        });
      } else {
        reportStatus({
          level: "Info",
          message: appliedMessage,
          toastType: "success",
          source: "UI",
        });
      }
    } catch (error) {
      if (!isCurrentOperation()) return;
      if (await recoverDeviceRead(selectedDevice, error)) return;
      if (!isCurrentOperation()) return;
      if (
        !manualDisconnectRef.current &&
        !isDevDummyDevice(selectedDevice) &&
        isDisconnectionError(error)
      ) {
        markDeviceLost(
          {
            setConnected,
            setIsReconnecting,
            setLastPushedPeq,
            setFirmwareVersion,
            reportStatus: reportLoss,
          },
          i18n.t("device:applyProfileToRam.applyDisconnected", {
            error: error,
          }),
          "HID",
        );
      } else {
        reportStatus({
          level: "Error",
          message: i18n.t("device:applyProfileToRam.applyFailed", {
            error: error,
          }),
          toastType: "error",
          source: "UI",
        });
      }
    } finally {
      if (operationId === eqOperationIdRef.current) {
        eqOperationInFlightRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };
}
