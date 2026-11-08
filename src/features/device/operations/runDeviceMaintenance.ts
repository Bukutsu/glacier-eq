import {
  claimEqOperation,
  releaseEqOperation,
} from "@/features/device/lib/eqOperationLock";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";

export type DeviceMaintenanceRunner = (
  task: (isCurrent: () => boolean) => Promise<void>,
) => Promise<void>;

type MaintenanceContext = Pick<
  DeviceState,
  | "connectedRef"
  | "connectedPathRef"
  | "connectedSessionIdRef"
  | "connectionGenerationRef"
  | "eqOperationInFlightRef"
  | "eqLock"
  | "setMaintenancePending"
  | "isBusy"
>;

/** Reserve the shared operation slot before confirmation, not after it. */
export function createDeviceMaintenanceRunner(
  context: MaintenanceContext,
): DeviceMaintenanceRunner {
  return async (task) => {
    if (
      context.isBusy ||
      context.eqOperationInFlightRef.current ||
      !context.connectedRef.current
    )
      return;
    const path = context.connectedPathRef.current;
    if (!path) return;
    const session = context.connectedSessionIdRef.current;
    const generation = context.connectionGenerationRef.current;
    const operation = claimEqOperation(context.eqLock);
    context.setMaintenancePending(true);
    const isCurrent = () =>
      context.connectedRef.current &&
      context.connectedPathRef.current === path &&
      context.connectedSessionIdRef.current === session &&
      context.connectionGenerationRef.current === generation;
    try {
      await task(isCurrent);
    } finally {
      if (releaseEqOperation(context.eqLock, operation))
        context.setMaintenancePending(false);
    }
  };
}
