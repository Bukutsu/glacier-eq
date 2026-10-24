import type { AppSettings } from "@/types";
import type { StatusReporter } from "@/stores/toastStore";
import type { ReportStatus } from "@/features/diagnostics/types";

import type { ChooseUserBank } from "@/features/device/lib/melodySlot";

export interface DeviceSessionOptions {
  chooseUserBank?: ChooseUserBank;
  settings: AppSettings;
  isMobile: boolean;
  isAndroid: boolean;
  reportStatus: ReportStatus;
  reportLoss: ReportStatus;
  setStatus: StatusReporter;
  setShowDeviceModal: (show: boolean) => void;
}
