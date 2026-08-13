import { Component, ErrorInfo, ReactNode } from "react";

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
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: "var(--bg)", color: "var(--text)", height: "100vh", fontFamily: "var(--font-ui)" }}>
          <h2>Something went wrong</h2>
          <pre style={{ color: "var(--red)" }}>{this.state.error?.toString()}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", background: "var(--surface-soft)", color: "var(--text)", border: "none", borderRadius: "var(--radius-control)", cursor: "pointer" }}
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
