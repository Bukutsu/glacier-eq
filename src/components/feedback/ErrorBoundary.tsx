import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@/lib/rpc";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    invoke("add_diagnostic_event", {
      level: "Error",
      source: "UI",
      message: `Render crash: ${error?.message || error}${errorInfo.componentStack ? `\nStack: ${errorInfo.componentStack}` : ""}`,
    }).catch(() => undefined);
  }

  public render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}

function ErrorFallback({ error }: { error: Error | null }) {
  const { t } = useTranslation("shell");
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        padding: 24,
        background: "var(--bg)",
        color: "var(--text)",
        height: "100vh",
        fontFamily: "var(--font-ui)",
      }}
    >
      <h2>{t("feedback.applicationError")}</h2>
      <pre style={{ color: "var(--destructive-foreground)" }}>
        {error?.toString()}
      </pre>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 16px",
          background: "var(--surface-soft)",
          color: "var(--text)",
          border: "none",
          borderRadius: "var(--radius-control)",
          cursor: "pointer",
        }}
      >
        {t("actions.reload")}
      </button>
    </div>
  );
}
