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
  profileDirty: boolean;
  deviceMatchesEditor: boolean | null;
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
  profileDirty,
  deviceMatchesEditor,
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

  useEffect(() => setMenuOpen(false), [connected]);

  const syncClass = !connected
    ? "offline"
    : isBusy
      ? "working"
      : deviceMatchesEditor === null
        ? "unknown"
        : deviceMatchesEditor
          ? "ok"
          : "unsaved";
  const syncText = !connected
    ? "Device disconnected"
    : isBusy
      ? progress
        ? `${progress.message} · ${Math.round(progress.percentage)}%`
        : "Working"
      : deviceMatchesEditor === null
        ? "Device state unknown"
        : deviceMatchesEditor
          ? "Device matches editor"
          : "Changes not on device";
  const profileText = profile === "Pulled from device"
    ? "Not saved as profile"
    : profileDirty
      ? "Profile modified"
      : "Profile saved";

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
            <span>{profileText}</span>
            <span>{activeBands}/{maxBands} bands</span>
            <span>{preampDb.toFixed(1)} dB preamp</span>
            {connected && <span>{supportsRamApply ? "Temporary apply available" : "Persistent writes only"}</span>}
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
              <button className="btn tonal" title="Replace the editor with EQ read from the DAC" onClick={onPull} disabled={isBusy}>Read DAC</button>
              <button className="btn filled" title="Store the editor EQ on the DAC" onClick={onPush} disabled={isBusy}>Write DAC</button>
              <button className="btn tonal" onClick={onDisconnect} disabled={isBusy}>Disconnect</button>
            </>
          ) : (
            <button className="btn filled" onClick={onConnectClick} disabled={isBusy}>
              <span className="material-symbols-outlined" style={{ marginRight: "6px", fontSize: "18px" }}>link</span>
              Connect DAC
            </button>
          )}
        </div>

        {/* Mobile uses the same action hierarchy as desktop, without duplicate actions. */}
        <div className="mobile-toolbar">
          <div className="history-buttons mobile-history-buttons" aria-label="Edit history">
            <button
              type="button"
              className="history-btn"
              title="Undo"
              aria-label="Undo"
              disabled={isBusy || !canUndo}
              onClick={onUndo}
            >
              <span className="material-symbols-outlined">undo</span>
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
            </button>
          </div>
          {connected ? (
            <>
              <button type="button" className="btn tonal mobile-action-btn" title="Read EQ from DAC" onClick={onPull} disabled={isBusy}>Read</button>
              <button type="button" className="btn filled mobile-action-btn" title="Write EQ to DAC" onClick={onPush} disabled={isBusy}>Write</button>
              <div className="mobile-menu-container" ref={menuRef}>
                <button
                  type="button"
                  className="mobile-more-btn"
                  title="More actions"
                  aria-label="More actions"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <span className="material-symbols-outlined">more_vert</span>
                </button>
                {menuOpen && (
                  <div className="mobile-dropdown-menu">
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
                  </div>
                )}
              </div>
            </>
          ) : (
            <button type="button" className="btn filled mobile-action-btn mobile-connect-btn" onClick={onConnectClick} disabled={isBusy}>
              <span className="material-symbols-outlined">link</span>
              Connect DAC
            </button>
          )}
        </div>
      </div>
      {isBusy && (
        <div className="header-progress-bar">
          <div
            className={`header-progress-fill ${progress ? "" : "indeterminate"}`}
            style={progress ? { transform: `scaleX(${Math.max(0, Math.min(100, progress.percentage)) / 100})` } : undefined}
          />
        </div>
      )}
    </header>
  );
}
