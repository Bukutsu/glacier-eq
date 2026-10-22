import type { DeviceInfo } from "@/types";
import { isDevDummyDevice } from "../lib/devDevice";

interface ConnectPrimaryContext {
  canStart: () => boolean;
  setBusy: (busy: boolean) => void;
  pauseReconnect: () => void;
  authorize: () => Promise<unknown>;
  scan: () => Promise<DeviceInfo[]>;
  connect: (path: string, device: DeviceInfo) => Promise<boolean>;
  showChooser: () => void;
  reportError: (error: unknown) => void;
}

/** The normal path is one DAC. Never guess between multiple devices. */
export function createConnectPrimary(context: ConnectPrimaryContext) {
  let pending = false;
  return async () => {
    if (pending || !context.canStart()) return;
    pending = true;
    context.pauseReconnect();
    context.setBusy(true);
    try {
      // WebHID authorization must start within the original user gesture.
      await context.authorize();
      const devices = (await context.scan()).filter(
        (device) => !isDevDummyDevice(device.path),
      );
      if (
        devices.length !== 1 ||
        !(await context.connect(devices[0].path, devices[0]))
      ) {
        context.showChooser();
      }
    } catch (error) {
      context.reportError(error);
      context.showChooser();
    } finally {
      pending = false;
      context.setBusy(false);
    }
  };
}
