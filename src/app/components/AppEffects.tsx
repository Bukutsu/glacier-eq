import { useEffect } from "react";
import { invoke } from "@/lib/rpc";
import { createExternalLinkClickHandler } from "@/lib/externalLinks";
import { useAppUpdate } from "@/features/settings/hooks/useAppUpdate";
import { useAndroidKeyboardViewport } from "@/hooks/useAndroidKeyboardViewport";

export function AppEffects() {
  useAndroidKeyboardViewport();

  // Supported desktop builds look for a newer release once per launch.
  useEffect(() => {
    void useAppUpdate.getState().checkOnLaunch();
  }, []);

  // Open external links in default browser instead of dropping them in Tauri webviews
  useEffect(() => {
    const handleGlobalClick = createExternalLinkClickHandler();

    document.addEventListener("click", handleGlobalClick);
    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  // Global uncaught error and promise rejection logger
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // eslint-disable-next-line i18next/no-literal-string -- Raw diagnostics stay language-independent.
      const msg = `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
      invoke("add_diagnostic_event", {
        level: "Error",
        source: "UI",
        message: msg,
      }).catch((err) => console.error("Failed to log uncaught error:", err));
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      // eslint-disable-next-line i18next/no-literal-string -- Raw diagnostics stay language-independent.
      const msg = `Unhandled rejection: ${reasonStr}`;
      invoke("add_diagnostic_event", {
        level: "Error",
        source: "UI",
        message: msg,
      }).catch((err) =>
        console.error("Failed to log unhandled rejection:", err),
      );
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
