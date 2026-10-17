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
> & {
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
    const generation = connectionGenerationRef.current;
    const session = connectedSessionIdRef.current;
    const isCurrent = () =>
      generation === connectionGenerationRef.current &&
      session === connectedSessionIdRef.current &&
      connectedPathRef.current === path;
    try {
      if (
        !(await confirmDialog({
          title: "Reset device EQ?",
          message: "Reset all hardware EQ bands on the DAC to 0 dB?",
          confirmLabel: "Reset",
          danger: true,
        })) ||
        !isCurrent()
      )
        return;
      setProgress({ message: "Resetting device EQ…", percentage: 0 });
      const restarts =
        (await invokeForDevice<boolean | undefined>(
          path,
          "reset_device_eq",
        )) === true;
      if (!isCurrent()) return;
      if (restarts) {
        const outcome = resetEqOutcome(true, undefined);
        setStatus(outcome.message, outcome.type);
        setProgress({ message: "Waiting for DAC restart…", percentage: 100 });
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
        setStatus(`Could not reset device EQ: ${error}`, "error");
      }
    } finally {
      if (operationId === eqOperationIdRef.current)
        eqOperationInFlightRef.current = false;
      setMaintenancePending(false);
      setProgress(null);
    }
  };
}
