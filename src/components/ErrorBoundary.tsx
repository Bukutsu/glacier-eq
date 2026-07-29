import React, { Component, ErrorInfo, ReactNode } from "react";

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
        <div style={{ padding: 24, background: "#1a1a1a", color: "#fff", height: "100vh", fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <pre style={{ color: "#ff6b6b" }}>{this.state.error?.toString()}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
