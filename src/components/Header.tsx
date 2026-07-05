import { useState, useRef, useEffect } from "react";
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
  onConnectClick?: () => void;
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
  onConnectClick,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const syncClass = !connected ? "offline" : isBusy ? "working" : dirty ? "unsaved" : "ok";
  const syncText = !connected
    ? "Offline"
    : isBusy
      ? progress
        ? `${progress.message} · ${Math.round(progress.percentage)}%`
        : "Working"
      : dirty
        ? "Unsaved"
        : "Synced";

  return (
    <header className="app-header">
      <div className="header-main">
        <div className="title-stack">
          <div className="title-line">
            <h1>{profile}</h1>
            <GithubLink />
          </div>
          <div className="header-meta-row">
            <div className="device-name">{connected ? deviceName : "No device"}</div>
            <span className={`sync-dot ${syncClass}`}>{syncText}</span>
          </div>
          <div className="header-session-strip" aria-label="EQ session status">
            <span>{activeBands}/{maxBands} bands</span>
            <span>{preampDb.toFixed(1)} dB preamp</span>
            <span>{supportsRamApply ? "RAM apply" : "Flash write"}</span>
            {firmwareVersion && <span>FW {firmwareVersion}</span>}
          </div>
        </div>
        {/* Desktop Toolbar */}
        <div className="toolbar desktop-toolbar">
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
          {connected ? (
            <>
              <button className="btn tonal" onClick={onPull} disabled={isBusy}>Pull</button>
              <button className="btn filled" onClick={onPush} disabled={isBusy}>Push</button>
              <button className="btn tonal" onClick={onDisconnect} disabled={isBusy}>Disconnect</button>
            </>
          ) : (
            <button className="btn filled" onClick={onConnectClick} disabled={isBusy}>
              <span className="material-symbols-outlined" style={{ marginRight: "6px", fontSize: "18px" }}>link</span>
              Connect DAC
            </button>
          )}
        </div>

        {/* Mobile Toolbar (M3 style) */}
        <div className="mobile-toolbar">
          <button
            type="button"
            className="mobile-icon-btn"
            title="Undo"
            aria-label="Undo"
            disabled={isBusy || !canUndo}
            onClick={onUndo}
          >
            <span className="material-symbols-outlined">undo</span>
          </button>
          <button
            type="button"
            className="mobile-icon-btn"
            title="Redo"
            aria-label="Redo"
            disabled={isBusy || !canRedo}
            onClick={onRedo}
          >
            <span className="material-symbols-outlined">redo</span>
          </button>
          {connected ? (
            <button
              type="button"
              className="mobile-icon-btn primary"
              title="Push settings"
              aria-label="Push settings"
              disabled={isBusy}
              onClick={onPush}
            >
              <span className="material-symbols-outlined">publish</span>
            </button>
          ) : (
            <button
              type="button"
              className="mobile-icon-btn primary"
              title="Connect DAC"
              aria-label="Connect DAC"
              disabled={isBusy}
              onClick={onConnectClick}
            >
              <span className="material-symbols-outlined">link</span>
            </button>
          )}
          <div className="mobile-menu-container" ref={menuRef}>
            <button
              type="button"
              className="mobile-icon-btn"
              title="More actions"
              aria-label="More actions"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="material-symbols-outlined">more_vert</span>
            </button>
            {menuOpen && (
              <div className="mobile-dropdown-menu">
                {connected ? (
                  <>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        onPull();
                        setMenuOpen(false);
                      }}
                      disabled={isBusy}
                    >
                      <span className="material-symbols-outlined">download</span>
                      <span>Pull from device</span>
                    </button>
                    <button
                      type="button"
                      className="dropdown-item danger"
                      onClick={() => {
                        onDisconnect();
                        setMenuOpen(false);
                      }}
                      disabled={isBusy}
                    >
                      <span className="material-symbols-outlined">link_off</span>
                      <span>Disconnect</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      onConnectClick?.();
                      setMenuOpen(false);
                    }}
                    disabled={isBusy}
                  >
                    <span className="material-symbols-outlined">link</span>
                    <span>Connect DAC</span>
                  </button>
                )}
              </div>
            )}
          </div>
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
