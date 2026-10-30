import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect } from "react";

import { invoke } from "@/lib/rpc";

import { useToastStore, type StatusReporter } from "@/stores/toastStore";

import { writeLocalStorage } from "@/lib/safeStorage";
import { quietLossReport } from "@/features/device/lib/deviceOperations";
import type { StatusReport } from "@/features/diagnostics/types";

import type { RefObject } from "react";

export function useAppFeedback(quietReconnectRef: RefObject<boolean>) {
  const { t } = useTranslation("shell");
  const status = useToastStore((s) => s.status);

  // One in-app notification path on every platform; Android previously also
  // showed a native toast for the same status update.
  const showToast = useCallback(
    (
      message: string,
      type: "info" | "error" | "success" = "info",
      log = true,
    ) => {
      useToastStore.getState().addToast(message, type, log);
    },
    [],
  );

  // One place turns a toast into a diagnostic event, registered once so every
  // toast is reported — including the ones raised from modules that cannot
  // reach App. Without this the store emitted nothing structured, so a
  // failure it was the only witness to left no reportable trail.
  useEffect(() => {
    useToastStore.getState().setDiagnosticSink((message, type) => {
      invoke("add_diagnostic_event", {
        level: type === "error" ? "Error" : "Info",
        source: "UI",
        message: `Status: ${message}`,
      }).catch((err) =>
        console.error("Failed to log diagnostic from toast:", err),
      );
    });
    return () => useToastStore.getState().setDiagnosticSink(null);
  }, []);

  const persistUiPreference = useCallback(
    (key: string, value: string) => {
      if (!writeLocalStorage(key, value)) {
        showToast(t("feedback.preferenceNotSaved"), "error");
      }
    },
    [showToast, t],
  );

  const setStatus = useCallback<StatusReporter>(
    (message, type) => useToastStore.getState().setStatus(message, type),
    [],
  );

  // An options object, not five positional parameters: `message` and
  // `statusText` are both `string`, so a transposed call still compiled and
  // silently wrote the long diagnostic sentence into the status bar and the
  // short status label into both the toast and the diagnostic record.
  const reportStatus = useCallback(
    ({
      level,
      message,
      toastType = null,
      source = "UI",
      statusText = message,
    }: StatusReport) => {
      useToastStore.setState({ status: statusText });
      invoke("add_diagnostic_event", { level, source, message }).catch((err) =>
        console.error("Failed to log diagnostic:", err),
      );
      if (toastType) {
        showToast(message, toastType, false);
      }
    },
    [showToast],
  );

  const reportLoss = useCallback(
    (status: Parameters<typeof reportStatus>[0]) => {
      reportStatus(
        quietReconnectRef.current ? quietLossReport(status) : status,
      );
    },
    [reportStatus],
  );
  return {
    status,
    showToast,
    persistUiPreference,
    setStatus,
    reportStatus,
    reportLoss,
  };
}
