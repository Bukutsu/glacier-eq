import { ToolbarButton } from "./ToolbarButton";

interface HeaderProps {
  connected: boolean;
  isBusy: boolean;
  profile: string;
  deviceName: string;
  dirty: boolean;
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
        <div className="device-name">{deviceName}</div>
      </div>
      <div className="toolbar">
        <ToolbarButton onClick={onPull} disabled={isBusy}>Pull</ToolbarButton>
        <ToolbarButton primary onClick={onPush} disabled={isBusy}>Push</ToolbarButton>
        <ToolbarButton onClick={onDisconnect} disabled={isBusy}>Disconnect</ToolbarButton>
      </div>
    </header>
  );
}
