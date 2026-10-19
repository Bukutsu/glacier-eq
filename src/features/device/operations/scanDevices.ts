import { i18n } from "@/lib/i18n";
import type { invoke } from "@/lib/rpc";

import type { DeviceInfo } from "@/types";
import { type StatusReporter } from "@/stores/toastStore";

import type { DeviceState } from "@/features/device/hooks/useDeviceState";

import type { ReportStatus } from "@/features/diagnostics/types";

export type ScanDevicesContext = Pick<
  DeviceState,
  | "setDevices"
  | "devPreviewDeviceRef"
  | "setSelectedDevice"
  | "connectedRef"
  | "connectedPathRef"
  | "setIsBusy"
> & {
  includeSimulated: boolean;
  reportStatus: ReportStatus;
  setStatus: StatusReporter;
  invoke: typeof invoke;
};

export function createScanDevices(context: ScanDevicesContext) {
  const {
    includeSimulated,
    setDevices,
    devPreviewDeviceRef,
    setSelectedDevice,
    connectedRef,
    connectedPathRef,
    setIsBusy,
    reportStatus,
    setStatus,
    invoke,
  } = context;
  return async (blockEditor = true) => {
    if (blockEditor) setIsBusy(true);
    reportStatus({
      level: "Info",
      message: i18n.t("device:scanDevices.searchingForDacs"),
    });
    try {
      const realDevices = await invoke<DeviceInfo[]>("list_devices");
      const list = includeSimulated
        ? [...realDevices, devPreviewDeviceRef.current]
        : realDevices;
      setDevices((currentDevices) => {
        const activePath = connectedPathRef.current;
        if (
          connectedRef.current &&
          activePath &&
          !list.some((device) => device.path === activePath)
        ) {
          const activeDevice = currentDevices.find(
            (device) => device.path === activePath,
          );
          // Keep the active device's identity/capabilities visible until the
          // disconnect poll confirms loss; a rescan must not retarget the
          // editor to an unrelated replacement device.
          return activeDevice ? [...list, activeDevice] : list;
        }
        return list;
      });
      setSelectedDevice((current) => {
        const activePath = connectedPathRef.current;
        if (connectedRef.current && activePath) return activePath;
        return list.some((device) => device.path === current)
          ? current
          : (list[0]?.path ?? "");
      });
      reportStatus({
        level: "Info",
        message: list.length
          ? i18n.t("device:scanDevices.foundDevices", { count: list.length })
          : i18n.t("device:scanDevices.noCompatibleDacsFound"),
      });
    } catch (error) {
      if (includeSimulated && !connectedRef.current) {
        setDevices([devPreviewDeviceRef.current]);
        setSelectedDevice(devPreviewDeviceRef.current.path);
        reportStatus({
          level: "Warn",
          message: i18n.t("device:scanDevices.simulationFallback", {
            error: error,
          }),
        });
        return;
      }
      setStatus(i18n.t("device:scanDevices.scanFailed", { error: error }));
    } finally {
      if (blockEditor) setIsBusy(false);
    }
  };
}
