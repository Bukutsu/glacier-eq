import type { invoke, emit, sleep } from "@/lib/rpc";
import type { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  readDevDummyPeq,
  isDevDummyDevice,
} from "@/features/device/lib/devDevice";
import { normalizePeq } from "@/features/eq/lib/peq";

import { isDisconnectionError } from "@/lib/errors";
import { asyncContextEquals } from "@/lib/asyncContext";
import { resolvePulledProfile } from "@/features/profiles/lib/pulledProfile";
import type { PEQData } from "@/types";
import { type StatusReporter } from "@/stores/toastStore";
import { useDebugStore } from "@/features/diagnostics/stores/debugStore";

import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import type { ReportStatus } from "@/features/diagnostics/types";

export type PullEqContext = Pick<
  DeviceState,
  | "manualDisconnectRef"
  | "selectedDevice"
  | "connected"
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
  | "selectedCapabilities"
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
    setStatus: StatusReporter;
    recoverDeviceRead: (path: string, error: unknown) => Promise<boolean>;
    invoke: typeof invoke;
    sleep: typeof sleep;
    emit: typeof emit;
    confirmDialog: typeof confirmDialog;
  };

export function createPullEq(context: PullEqContext) {
  const {
    manualDisconnectRef,
    selectedDevice,
    connected,
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
    selectedCapabilities,
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
    setStatus,
    recoverDeviceRead,
    invoke,
    sleep,
    emit,
    confirmDialog,
  } = context;
  return async (
    afterConnect = false,
    targetPath = selectedDevice,
    targetCapabilities = selectedCapabilities,
  ): Promise<boolean> => {
    if (!connected && !afterConnect) {
      setStatus("Connect a DAC before reading its EQ.", "info");
      return false;
    }
    if (eqOperationInFlightRef.current) return false;
    // Invalidate older async work before opening the confirmation, then capture
    // identity/context. A disconnect/reconnect or editor edit while the dialog
    // is open must not redirect this operation to a replacement device.
    operationRevisionRef.current += 1;
    const confirmationContext = getAsyncContext();
    const confirmationPath = connectedPathRef.current;
    const confirmationSessionId = connectedSessionIdRef.current;
    const confirmationGeneration = connectionGenerationRef.current;
    const confirmationTargetPath = targetPath;
    const confirmationCapabilities = targetCapabilities;
    const isConfirmationCurrent = () =>
      asyncContextEquals(confirmationContext, getAsyncContext()) &&
      connectionGenerationRef.current === confirmationGeneration &&
      connectedPathRef.current === confirmationPath &&
      connectedSessionIdRef.current === confirmationSessionId &&
      targetPath === confirmationTargetPath &&
      targetCapabilities === confirmationCapabilities;
    // Preview connections confirm replacement before changing the model.
    const replacingPreview = afterConnect && isDevDummyDevice(targetPath);
    if (
      dirty &&
      !replacingPreview &&
      !useDebugStore.getState().autoDiscardEq &&
      !(await confirmDialog({
        title: "Discard changes?",
        message: "Reading EQ from the DAC will discard your unsaved changes.",
        confirmLabel: "Discard and read",
      }))
    )
      return false;
    if (!isConfirmationCurrent()) return false;
    // Claim the shared operation slot and stamp the pull, so a superseded
    // pull cannot clear the busy state its replacement still holds. pushEq and
    // applyProfileToRam both fence on this; without the fence a pull that
    // runs as an inner step of connectDevice or the reconnect poll released
    // busy while its caller still had a firmware read outstanding.
    const operationId = ++eqOperationIdRef.current;
    eqOperationInFlightRef.current = true;
    setProgress(null);
    setIsBusy(true);
    // A pull must not land on an editor/connection state that changed while
    // the device read or profile match ran; the undo snapshot is deferred
    // until the result is known to be current.
    const isCurrentPull = () => isConfirmationCurrent();
    try {
      let data: PEQData;
      if (isDevDummyDevice(targetPath)) {
        setProgress({
          message: "Preparing EQ read…",
          percentage: 5,
        });
        await sleep(200);
        setProgress({
          message: `Reading band 1/${targetCapabilities.num_bands}…`,
          percentage: 15,
        });
        await sleep(150);
        setProgress({ message: "Reading EQ bands…", percentage: 40 });
        await sleep(150);
        setProgress({ message: "Reading filter settings…", percentage: 65 });
        await sleep(150);
        setProgress({
          message: `Read ${targetCapabilities.num_bands} bands`,
          percentage: 85,
        });
        await sleep(150);
        setProgress({ message: "Reading device preamp…", percentage: 90 });
        await sleep(150);
        setProgress({ message: "Read complete", percentage: 100 });
        await sleep(400);
        data = readDevDummyPeq(targetPath);
      } else {
        data = await invoke<PEQData>("get_eq_state");
        await sleep(400);
      }
      if (!isCurrentPull()) return false;
      const normalized = normalizePeq(data, {
        integerPreamp: targetCapabilities.integer_preamp,
        capabilities: targetCapabilities,
      });
      const matchedProfile = await resolvePulledProfile(
        normalized,
        (peq) => invoke<string | null>("match_profile_name", { peq }),
        isCurrentPull,
      );
      if (matchedProfile === null || !isCurrentPull()) return false;
      pushToUndoStack(peqRef.current);
      setPeq(normalized);
      setLastPushedPeq(normalized);
      setSelectedPreset(matchedProfile);
      setProfileSearch("");
      setNewProfileName("");
      noteEditorMutation();
      const simulated = isDevDummyDevice(targetPath);
      // The read EQ is the baseline whether or not a saved profile matches it.
      // An unmatched one stays dirty so it can be saved as a profile and a
      // profile switch asks first, but it is not unfinished work: the DAC
      // still holds it, so it must not be kept as a recovery draft.
      editorCleanPeqRef.current = normalized;
      // Browsing seeded previews is not an unsaved user edit. Actual edits
      // still use the normal dirty/draft protection and switch confirmation.
      setDirty(!simulated && matchedProfile === "Pulled from device");
      emit("device-pull").catch((err) =>
        console.error("Failed to emit device-pull:", err),
      );
      reportStatus({
        level: "Info",
        message: isDevDummyDevice(targetPath)
          ? "Loaded simulated DAC EQ"
          : "Loaded EQ from DAC",
        source: "UI",
      });
      return true;
    } catch (error) {
      // A pull that lost its editor/connection context mid-read must not
      // report against newer state or clear a connection made after it
      // started; only a current pull may act on its failure.
      if (!isCurrentPull()) return false;
      if (await recoverDeviceRead(targetPath, error)) return false;
      if (!isCurrentPull()) return false;
      if (!manualDisconnectRef.current && isDisconnectionError(error)) {
        markDeviceLost(
          {
            setConnected,
            setIsReconnecting,
            setLastPushedPeq,
            setFirmwareVersion,
            reportStatus: reportLoss,
          },
          `Could not read from DAC (disconnected): ${error}`,
          "HID",
        );
      } else {
        reportStatus({
          level: "Error",
          message: `Could not read from DAC: ${error}`,
          toastType: "error",
          source: "UI",
        });
      }
      return false;
    } finally {
      if (operationId === eqOperationIdRef.current) {
        eqOperationInFlightRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };
}
