import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@/lib/rpc";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "@/components/ui/Button";

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
    <main className="error-boundary">
      <ErrorNotice
        title={t("feedback.applicationError")}
        action={
          <Button onClick={() => window.location.reload()}>
            {t("actions.reload")}
          </Button>
        }
      >
        {error?.toString()}
      </ErrorNotice>
    </main>
  );
}
