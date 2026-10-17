export type ReportLevel = "Info" | "Warn" | "Error";
export type ReportToast = "success" | "info" | "error" | null;
export type ReportSource = "UI" | "Worker" | "HID" | "AutoEQ" | "Device";

export interface StatusReport {
  level: ReportLevel;
  message: string;
  toastType?: ReportToast;
  source?: ReportSource;
  statusText?: string;
}

export type ReportStatus = (status: StatusReport) => void;
