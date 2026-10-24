import { i18n } from "@/lib/i18n";
import {
  melodySlotArgs,
  userEqSlotArgs,
  getUserEqSlot,
} from "@/features/device/lib/melodySlot";
import type { invokeForDevice } from "@/lib/rpc";
import type { confirmDialog } from "@/components/ui/ConfirmDialog";

import { type StatusReporter } from "@/stores/toastStore";

import { resetEqOutcome } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";

import type { DeviceCapabilities } from "@/types";

export type ResetDeviceEqContext = Pick<
  DeviceState,
  | "connectedRef"
  | "connectedPathRef"
  | "connectedSessionIdRef"
  | "connectionGenerationRef"
  | "setMaintenancePending"
  | "isBusy"
  | "setProgress"
  | "eqOperationInFlightRef"
  | "eqOperationIdRef"
> &
  Partial<Pick<DeviceState, "selectedDeviceInfo">> & {
    setStatus: StatusReporter;
    recoverDeviceRead: (path: string, error: unknown) => Promise<boolean>;
    handleExpectedDisconnect: (restart?: boolean) => Promise<void>;
    pullEq: (
      afterConnect?: boolean,
      targetPath?: string,
      targetCapabilities?: DeviceCapabilities,
    ) => Promise<boolean>;
    invokeForDevice: typeof invokeForDevice;
    confirmDialog: typeof confirmDialog;
  };

export function createResetDeviceEq(context: ResetDeviceEqContext) {
  const {
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectionGenerationRef,
    setMaintenancePending,
    isBusy,
    setProgress,
    eqOperationInFlightRef,
    eqOperationIdRef,
    setStatus,
    recoverDeviceRead,
    handleExpectedDisconnect,
    pullEq,
    invokeForDevice,
    confirmDialog,
  } = context;
  return async () => {
    if (isBusy || eqOperationInFlightRef.current || !connectedRef.current)
      return;
    const path = connectedPathRef.current;
    if (!path) return;
    // Claim synchronously, including while confirmation is open. A second
    // click cannot queue another destructive reset before React re-renders.
    const operationId = ++eqOperationIdRef.current;
    eqOperationInFlightRef.current = true;
    setMaintenancePending(true);
    const slots = context.selectedDeviceInfo?.user_eq_slots ?? [];
    const slot = getUserEqSlot(path);
    const bankNumber = slot === undefined ? 0 : slots.indexOf(slot) + 1;
    const bankArgs =
      slots.length && context.selectedDeviceInfo?.controls !== "melody"
        ? userEqSlotArgs(path)
        : melodySlotArgs(path);
    const generation = connectionGenerationRef.current;
    const session = connectedSessionIdRef.current;
    const isCurrent = () =>
      generation === connectionGenerationRef.current &&
      session === connectedSessionIdRef.current &&
      connectedPathRef.current === path;
    try {
      if (
        !(await confirmDialog({
          title: i18n.t("device:resetDeviceEq.resetDeviceEq"),
          message:
            bankNumber > 0 || "melody_slot" in bankArgs
              ? i18n.t("device:melodyControls.resetConfirmation", {
                  slot: bankNumber || Number(bankArgs.melody_slot) - 159,
                  bands: context.selectedDeviceInfo?.num_bands ?? 10,
                })
              : i18n.t("device:resetDeviceEq.confirmation"),
          confirmLabel: i18n.t("device:resetDeviceEq.reset"),
          danger: true,
        })) ||
        !isCurrent()
      )
        return;
      setProgress({
        message: i18n.t("device:resetDeviceEq.resettingDeviceEq"),
        percentage: 0,
      });
      const restarts =
        (await invokeForDevice<boolean | undefined>(
          path,
          "reset_device_eq",
          bankArgs,
        )) === true;
      if (!isCurrent()) return;
      if (restarts) {
        const outcome = resetEqOutcome(true, undefined);
        setStatus(outcome.message, outcome.type);
        setProgress({
          message: i18n.t("device:resetDeviceEq.waitingForDacRestart"),
          percentage: 100,
        });
        await handleExpectedDisconnect(true);
      } else {
        // pullEq claims its own operation slot; maintenancePending continues
        // to disable the rest of the UI through read-back.
        eqOperationInFlightRef.current = false;
        const pulled = await pullEq();
        if (!isCurrent()) return;
        const outcome = resetEqOutcome(false, pulled);
        setStatus(outcome.message, outcome.type);
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (!(await recoverDeviceRead(path, error)) && isCurrent()) {
        setStatus(
          i18n.t("device:resetDeviceEq.resetFailed", {
            error: error,
          }),
          "error",
        );
      }
    } finally {
      if (operationId === eqOperationIdRef.current)
        eqOperationInFlightRef.current = false;
      setMaintenancePending(false);
      setProgress(null);
    }
  };
}
