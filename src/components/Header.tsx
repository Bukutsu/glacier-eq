import { OperationProgress } from "../types";
import { isTauri } from "../lib/platform";

const REPO_URL = "https://github.com/Bukutsu/glacier-eq";

function GithubLink() {
  if (isTauri()) return null;

  return (
    <a
      className="github-link"
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      title="GitHub repository"
      aria-label="GitHub repository"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 0.2A7.9 7.9 0 0 0 5.5 15.6c0.4 0.1 0.5-0.2 0.5-0.4v-1.4c-2.1 0.5-2.6-0.9-2.6-0.9-0.4-0.9-0.9-1.1-0.9-1.1-0.7-0.5 0.1-0.5 0.1-0.5 0.8 0.1 1.2 0.8 1.2 0.8 0.7 1.2 1.9 0.9 2.3 0.7 0.1-0.5 0.3-0.9 0.5-1.1-1.7-0.2-3.5-0.9-3.5-3.9 0-0.9 0.3-1.6 0.8-2.1-0.1-0.2-0.4-1 0.1-2.1 0 0 0.7-0.2 2.2 0.8A7.6 7.6 0 0 1 8 4.1c0.7 0 1.3 0.1 1.9 0.3 1.5-1 2.2-0.8 2.2-0.8 0.4 1.1 0.2 1.9 0.1 2.1 0.5 0.6 0.8 1.3 0.8 2.1 0 3-1.8 3.6-3.5 3.8 0.3 0.2 0.5 0.7 0.5 1.4v2.1c0 0.2 0.1 0.5 0.5 0.4A7.9 7.9 0 0 0 8 0.2z" />
      </svg>
    </a>
  );
}

interface HeaderProps {
  connected: boolean;
  isBusy: boolean;
  progress: OperationProgress | null;
  profile: string;
  deviceName: string;
  dirty: boolean;
  activeBands: number;
  maxBands: number;
  preampDb: number;
  supportsRamApply: boolean;
  firmwareVersion?: string | null;
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
  activeBands,
  maxBands,
  preampDb,
  supportsRamApply,
  firmwareVersion,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPull,
  onPush,
  onDisconnect,
}: HeaderProps) {
  const syncText = isBusy
    ? progress
      ? `${progress.message} · ${Math.round(progress.percentage)}%`
      : "Working"
    : dirty
      ? "Unsaved"
      : "Synced";

  if (!connected) {
    return (
      <header className="app-header selection-header">
        <div className="title-stack">
          <div className="title-line">
            <h1>Connect DAC</h1>
            <span className="sync-dot offline">● Offline</span>
            <GithubLink />
          </div>
          <div className="header-session-strip">
            <span>No device selected</span>
            <span>Scan or choose a supported DAC</span>
          </div>
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
            <GithubLink />
          </div>
          <div className="header-meta-row">
            <div className="device-name">{deviceName}</div>
            <span className={`sync-dot ${isBusy ? "working" : "ok"}`}>
              ● {syncText}
            </span>
          </div>
          <div className="header-session-strip" aria-label="EQ session status">
            <span>{activeBands}/{maxBands} bands</span>
            <span>{preampDb.toFixed(1)} dB preamp</span>
            <span>{supportsRamApply ? "RAM apply" : "Flash write"}</span>
            {firmwareVersion && <span>FW {firmwareVersion}</span>}
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
