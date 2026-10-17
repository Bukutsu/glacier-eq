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
        title: "Discard changes?",
        message: "Applying this profile will discard your unsaved changes.",
        confirmLabel: "Discard and apply",
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
    pushToUndoStack(peqRef.current);
    setPeq(data);
    noteEditorMutation();
    setSelectedPreset(profile.name);
    setProfileSearch("");
    setNewProfileName("");
    editorCleanPeqRef.current = data;
    setDirty(false);

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
        setProgress({ message: "Applying temporary EQ…", percentage: 60 });
        await sleep(250);
        setProgress({ message: "Temporary EQ applied", percentage: 100 });
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
      if (isDevDummyDevice(selectedDevice)) {
        setLastPushedPeq(writeDevDummyPeq(selectedDevice, data, false));
      }
      const appliedMessage = isDevDummyDevice(selectedDevice)
        ? "Temporary EQ application simulated"
        : `Applied ${profile.name} to the DAC temporarily`;
      if (applyWarnings.length > 0) {
        reportStatus({
          level: "Warn",
          message: `${appliedMessage}. ${applyWarnings.join(" · ")}`,
          toastType: "info",
          source: "UI",
          statusText: `${appliedMessage} (values adjusted to device limits)`,
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
          `Could not apply EQ (disconnected): ${error}`,
          "HID",
        );
      } else {
        reportStatus({
          level: "Error",
          message: `Could not apply EQ: ${error}`,
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
