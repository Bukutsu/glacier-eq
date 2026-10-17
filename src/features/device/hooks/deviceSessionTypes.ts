import type { AppSettings } from "@/types";
import type { StatusReporter } from "@/stores/toastStore";
import type { ReportStatus } from "@/features/diagnostics/types";

export interface DeviceSessionOptions {
  settings: AppSettings;
  isMobile: boolean;
  isAndroid: boolean;
  reportStatus: ReportStatus;
  reportLoss: ReportStatus;
  setStatus: StatusReporter;
  setShowDeviceModal: (show: boolean) => void;
}
