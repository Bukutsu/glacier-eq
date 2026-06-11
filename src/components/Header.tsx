import { ToolbarButton } from "./ToolbarButton";

interface HeaderProps {
  connected: boolean;
  isBusy: boolean;
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
            <h1>Glacier EQ</h1>
            <span className="sync-dot offline">● Offline</span>
          </div>
          <div className="device-name">Select a supported DAC to begin</div>
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="title-stack">
        <div className="title-line">
          <h1>Glacier EQ</h1>
          <span className="dash">—</span>
          <strong>{profile}</strong>
          {dirty && <span className="unsaved">UNSAVED</span>}
          <span className="sync-dot ok">● {isBusy ? "Working…" : "Synced"}</span>
        </div>
        <div className="header-meta-row">
          <div className="history-controls" aria-label="Edit history">
            <span className="history-label">History</span>
            <div className="history-buttons">
              <button
                type="button"
                className="history-btn"
                title="Undo"
                aria-label="Undo"
                disabled={isBusy || !canUndo}
                onClick={onUndo}
              >
                <ToolbarButtonIcon icon="undo" label="Undo" />
              </button>
              <button
                type="button"
                className="history-btn"
                title="Redo"
                aria-label="Redo"
                disabled={isBusy || !canRedo}
                onClick={onRedo}
              >
                <ToolbarButtonIcon icon="redo" label="Redo" />
              </button>
            </div>
          </div>
          <div className="device-name">{deviceName}</div>
        </div>
      </div>
      <div className="toolbar">
        <ToolbarButton onClick={onPull} disabled={isBusy}>Pull</ToolbarButton>
        <ToolbarButton primary onClick={onPush} disabled={isBusy}>Push</ToolbarButton>
        <ToolbarButton onClick={onDisconnect} disabled={isBusy}>Disconnect</ToolbarButton>
      </div>
    </header>
  );
}

function ToolbarButtonIcon({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      <span className="material-symbols-outlined">{icon}</span>
      <span>{label}</span>
    </>
  );
}
