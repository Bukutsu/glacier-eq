import { i18n } from "@/lib/i18n";
import {
  melodySlotArgs,
  setUserEqSlot,
  userEqSlotArgs,
} from "@/features/device/lib/melodySlot";
import type { ChooseUserBank } from "@/features/device/lib/melodySlot";
import type { invoke, sleep } from "@/lib/rpc";
import type { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  writeDevDummyPeq,
  isDevDummyDevice,
} from "@/features/device/lib/devDevice";
import {
  extractPushWarnings,
  formatDb,
  normalizePeq,
  parseStoredPeqResponse,
  peqEquals,
} from "@/features/eq/lib/peq";

import { isDisconnectionError } from "@/lib/errors";
import { asyncContextEquals } from "@/lib/asyncContext";

import type { PEQData } from "@/types";
import { type StatusReporter } from "@/stores/toastStore";

import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import type { ReportStatus } from "@/features/diagnostics/types";

export type PushEqContext = Pick<
  DeviceState,
  | "manualDisconnectRef"
  | "expectedRestartUntilRef"
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
  | "selectedDeviceInfo"
  | "capabilities"
> &
  Pick<
    EqEditor,
    | "setPeq"
    | "peqRef"
    | "noteEditorMutation"
    | "pushToUndoStack"
    | "getAsyncContext"
  > & {
    reportStatus: ReportStatus;
    reportLoss: ReportStatus;
    setStatus: StatusReporter;
    isMobile: boolean;
    recoverDeviceRead: (path: string, error: unknown) => Promise<boolean>;
    handleExpectedDisconnect: (restart?: boolean) => Promise<void>;
    invoke: typeof invoke;
    sleep: typeof sleep;
    confirmDialog: typeof confirmDialog;
    chooseUserBank?: ChooseUserBank;
  };

export function createPushEq(context: PushEqContext) {
  const {
    manualDisconnectRef,
    expectedRestartUntilRef,
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
    peqRef,
    noteEditorMutation,
    pushToUndoStack,
    getAsyncContext,
    reportStatus,
    reportLoss,
    setStatus,
    isMobile,
    recoverDeviceRead,
    handleExpectedDisconnect,
    invoke,
    sleep,
    confirmDialog,
  } = context;
  // `quiet` is the background save of live apply: no confirmation, no busy
  // overlay, no success toast, so the editor stays usable while it saves.
  return async (
    options: {
      quiet?: boolean;
      onSaved?: () => void;
      melodySlot?: number;
      fiioSlot?: number;
    } = {},
  ) => {
    const quiet = options.quiet === true;
    if (!connected) {
      if (!quiet) setStatus(i18n.t("device:pushEq.connectionRequired"), "info");
      return;
    }
    if (eqOperationInFlightRef.current) return;
    const snapshot = normalizePeq(peqRef.current, {
      integerPreamp: selectedCapabilities.integer_preamp,
      capabilities: selectedCapabilities,
    });
    operationRevisionRef.current += 1;
    const confirmationContext = getAsyncContext();
    const confirmationPath = connectedPathRef.current;
    const confirmationSessionId = connectedSessionIdRef.current;
    const confirmationGeneration = connectionGenerationRef.current;
    const confirmationCapabilities = selectedCapabilities;
    const isConfirmationCurrent = () =>
      asyncContextEquals(confirmationContext, getAsyncContext()) &&
      connectionGenerationRef.current === confirmationGeneration &&
      connectedPathRef.current === confirmationPath &&
      connectedSessionIdRef.current === confirmationSessionId &&
      selectedCapabilities === confirmationCapabilities;
    const activeBands = snapshot.filters.filter((f) => f.enabled).length;
    // Capture the destination before any async UI. Never read a mutable
    // global bank selection later, halfway through a confirmed write.
    const slots = context.selectedDeviceInfo?.user_eq_slots ?? [];
    const isMelody = context.selectedDeviceInfo?.controls === "melody";
    let bankArgs: Record<string, number> =
      options.fiioSlot !== undefined
        ? { fiio_slot: options.fiioSlot }
        : options.melodySlot !== undefined
          ? { melody_slot: options.melodySlot }
          : isMelody
            ? melodySlotArgs(selectedDevice)
            : userEqSlotArgs(selectedDevice);
    let destinationSlot = bankArgs.fiio_slot ?? bankArgs.melody_slot;
    let destinationConfirmed = false;
    if (
      !quiet &&
      context.chooseUserBank &&
      options.fiioSlot === undefined &&
      options.melodySlot === undefined
    ) {
      const choice = await context.chooseUserBank({
        path: selectedDevice,
        count: activeBands,
        preamp: formatDb(snapshot.global_gain),
        slots,
        isMelody,
      });
      if (choice === null || !isConfirmationCurrent()) return;
      setUserEqSlot(selectedDevice, choice.slot, slots);
      bankArgs = isMelody
        ? { melody_slot: choice.slot }
        : { fiio_slot: choice.slot };
      destinationSlot = choice.slot;
      destinationConfirmed = choice.confirmed;
    }
    const bankIndex =
      destinationSlot === undefined ? -1 : slots.indexOf(destinationSlot);
    const bankNumber = bankIndex < 0 ? undefined : bankIndex + 1;
    const targetSlot = isMelody
      ? (bankNumber ??
        (destinationSlot !== undefined ? destinationSlot - 159 : undefined))
      : bankNumber;
    if (
      !quiet &&
      !destinationConfirmed &&
      !(await confirmDialog({
        title:
          targetSlot !== undefined
            ? i18n.t("device:pushEq.writeMelodyBankTitle", {
                bank: targetSlot,
              })
            : isMobile
              ? i18n.t("device:pushEq.saveTitle")
              : i18n.t("device:pushEq.writeTitle"),
        message:
          targetSlot !== undefined
            ? i18n.t("device:pushEq.confirmWriteToMelodyBank", {
                bank: targetSlot,
                count: activeBands,
                preamp: formatDb(snapshot.global_gain),
              })
            : i18n.t("device:pushEq.confirmWrite", {
                count: activeBands,
                preamp: formatDb(snapshot.global_gain),
              }),
        confirmLabel:
          targetSlot !== undefined
            ? i18n.t("device:pushEq.writeMelodyBankAction", {
                bank: targetSlot,
              })
            : isMobile
              ? i18n.t("device:pushEq.saveAction")
              : i18n.t("device:pushEq.writeAction"),
        danger: true,
      }))
    )
      return;
    if (!isConfirmationCurrent() || eqOperationInFlightRef.current) return;
    eqOperationInFlightRef.current = true;
    const operationId = ++eqOperationIdRef.current;
    if (!quiet) {
      setProgress(null);
      setIsBusy(true);
    }
    let committedPeq: PEQData | null = null;
    let pushWarnings: string[] = [];
    let restarts = false;
    // Device completion depends on the session, not on editor changes.
    // An edit during the write must not hide what was saved to the DAC.
    const isCurrentOperation = () =>
      operationId === eqOperationIdRef.current &&
      getAsyncContext().operationRevision ===
        confirmationContext.operationRevision &&
      connectionGenerationRef.current === confirmationGeneration &&
      connectedPathRef.current === confirmationPath &&
      connectedSessionIdRef.current === confirmationSessionId &&
      selectedCapabilities === confirmationCapabilities;
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({
          message: i18n.t("device:pushEq.preparingEqWrite"),
          percentage: 10,
        });
        await sleep(200);
        setProgress({
          message: i18n.t("device:pushEq.writingBand", {
            num_bands: selectedCapabilities.num_bands,
          }),
          percentage: 20,
        });
        await sleep(150);
        setProgress({
          message: i18n.t("device:pushEq.writingEqBands"),
          percentage: 45,
        });
        await sleep(150);
        setProgress({
          message: i18n.t("device:pushEq.wroteBands", {
            count: selectedCapabilities.num_bands,
          }),
          percentage: 70,
        });
        await sleep(150);
        setProgress({
          message: i18n.t("device:pushEq.writingPreamp"),
          percentage: 75,
        });
        await sleep(150);
        setProgress({
          message: i18n.t("device:pushEq.savingEqToDac"),
          percentage: 80,
        });
        await sleep(200);
        setProgress({
          message: i18n.t("device:pushEq.verifyingChanges"),
          percentage: 90,
        });
        await sleep(200);
        if (!isCurrentOperation()) return;
        committedPeq = writeDevDummyPeq(
          selectedDevice,
          snapshot,
          true,
          destinationSlot,
        );
        setProgress({
          message: i18n.t("device:pushEq.writeComplete"),
          percentage: 100,
        });
        await sleep(400);
      } else {
        // set_eq_state returns the PEQ actually committed (quantized to the
        // protocol), not necessarily the request, plus any capability-clamp
        // warnings from normalization.
        setProgress({
          message: i18n.t("device:pushEq.preparingEqWrite"),
          percentage: 5,
        });
        const outcome = await invoke<unknown>("set_eq_state", {
          peq: snapshot,
          ...bankArgs,
        });
        pushWarnings = extractPushWarnings(outcome);
        restarts =
          (outcome as { restarts?: unknown } | null)?.restarts === true;
        if (restarts && isCurrentOperation())
          expectedRestartUntilRef.current = Date.now() + 15_000;
        committedPeq = parseStoredPeqResponse(outcome, {
          integerPreamp: selectedCapabilities.integer_preamp,
          capabilities: selectedCapabilities,
        });
      }
      // Both real devices and previews may clamp a write to model limits.
      // Adopt the committed state only if the editor/session is unchanged.
      if (
        committedPeq &&
        !peqEquals(committedPeq, snapshot) &&
        isCurrentOperation() &&
        isConfirmationCurrent()
      ) {
        pushToUndoStack(peqRef.current);
        setPeq(committedPeq);
        noteEditorMutation();
      }
      if (!isCurrentOperation()) return;
      setLastPushedPeq(committedPeq ?? snapshot);
      const savedMessage = isDevDummyDevice(selectedDevice)
        ? i18n.t("device:pushEq.eqWriteSimulated")
        : restarts
          ? i18n.t("device:pushEq.savedRestarting")
          : i18n.t("device:pushEq.savedEqToDac");
      if (pushWarnings.length > 0) {
        // The push rewrote out-of-range values, or ran with verification
        // switched off and so never read the DAC back: "Saved EQ to DAC"
        // alone would hide both.
        reportStatus({
          level: "Warn",
          message: i18n.t("device:pushEq.completionWarnings", {
            message: savedMessage,
            warnings: pushWarnings.join(" · "),
          }),
          toastType: quiet ? null : "info",
          source: "UI",
          statusText: i18n.t("device:pushEq.seeDetails", {
            savedMessage: savedMessage,
          }),
        });
      } else {
        reportStatus({
          level: "Info",
          message: savedMessage,
          toastType: quiet ? null : "success",
          source: "UI",
        });
      }
      options.onSaved?.();
      if (restarts) await handleExpectedDisconnect(true);
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
          i18n.t("device:pushEq.writeDisconnected", {
            error: error,
          }),
          "HID",
        );
      } else {
        reportStatus({
          level: "Error",
          message: i18n.t("device:pushEq.writeFailed", { error: error }),
          toastType: "error",
          source: "UI",
        });
      }
    } finally {
      if (operationId === eqOperationIdRef.current) {
        eqOperationInFlightRef.current = false;
        if (!quiet) setIsBusy(false);
        setProgress(null);
      }
    }
  };
}
