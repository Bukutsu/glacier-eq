import { OperationProgress } from "../types";

interface HeaderProps {
  connected: boolean;
  isBusy: boolean;
  progress: OperationProgress | null;
  profile: string;
  deviceName: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPull: () => void;
  onPush: () => void;
  onDisconnect: () => void;
}

export function Header({
  connected,
  isBusy,
  progress,
  profile,
  deviceName,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPull,
  onPush,
  onDisconnect,
}: HeaderProps) {
  if (!connected) {
    return (
      <header className="app-header selection-header">
        <div className="title-stack">
          <div className="title-line">
            <h1>Connect DAC</h1>
            <span className="sync-dot offline">● Offline</span>
          </div>
          <div className="device-name">Select a supported DAC to begin</div>
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="header-main">
        <div className="title-stack">
          <div className="title-line">
            <h1>{profile}</h1>
          </div>
          <div className="header-meta-row">
            <div className="device-name">{deviceName}</div>
            <span className={`sync-dot ${isBusy ? "working" : "ok"}`}>
              ● {isBusy
                ? progress
                  ? `${progress.message} (${Math.round(progress.percentage)}%)`
                  : "Working…"
                : "Synced"}
            </span>
            {dirty && <span className="unsaved">Unsaved</span>}
          </div>
        </div>
        <div className="toolbar">
          <div className="history-buttons" aria-label="Edit history">
            <button
              type="button"
              className="history-btn"
              title="Undo"
              aria-label="Undo"
              disabled={isBusy || !canUndo}
              onClick={onUndo}
            >
              <span className="material-symbols-outlined">undo</span>
              <span className="history-btn-label">Undo</span>
            </button>
            <button
              type="button"
              className="history-btn"
              title="Redo"
              aria-label="Redo"
              disabled={isBusy || !canRedo}
              onClick={onRedo}
            >
              <span className="material-symbols-outlined">redo</span>
              <span className="history-btn-label">Redo</span>
            </button>
          </div>
          <button className="btn tonal" onClick={onPull} disabled={isBusy}>Pull</button>
          <button className="btn filled" onClick={onPush} disabled={isBusy}>Push</button>
          <button className="btn tonal" onClick={onDisconnect} disabled={isBusy}>Disconnect</button>
        </div>
      </div>
      {isBusy && (
        <div className="header-progress-bar">
          <div
            className={`header-progress-fill ${progress ? "" : "indeterminate"}`}
            style={{ width: progress ? `${progress.percentage}%` : "100%" }}
          />
        </div>
      )}
    </header>
  );
}
