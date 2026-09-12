import { memo, useState, useRef, useEffect } from "react";
import { Icon } from "./Icon";
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
  inert?: boolean;
  connected: boolean;
  isSimulated?: boolean;
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
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPull: () => void;
  onPush: () => void;
  onDisconnect: () => void;
  onConnectClick?: () => void;
  configPage?: "device" | "settings";
  pageTitle?: string;
  compact?: boolean;
}

export const Header = memo(function Header({
  inert,
  connected,
  isSimulated = false,
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPull,
  onPush,
  onDisconnect,
  onConnectClick,
  configPage,
  pageTitle: pageTitleOverride,
  compact = false,
}: HeaderProps) {
  const isConfigPage = configPage !== undefined;
  const showDeviceEditorActions = !isConfigPage || configPage === "device";
  const pageTitle = pageTitleOverride ?? (configPage === "device" ? "Device" : configPage === "settings" ? "Settings" : profile);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [connected]);

  const syncClass = !connected
    ? "offline"
    : isBusy
      ? "working"
      : isSimulated
        ? "simulation"
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
      : isSimulated
        ? "Simulation · editor only"
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
    <header className={`app-header${compact ? " compact-mobile" : ""}`} inert={inert}>
      <div className="header-main">
        <div className="title-stack">
          <div className="title-line">
            <h1>{pageTitle}</h1>
            <GithubLink />
          </div>
          <div className="header-meta-row">
            {connected && <div className="device-name">{deviceName}</div>}
            <span className={`sync-dot ${syncClass}`}>{syncText}</span>
          </div>
          {!isConfigPage && (
            <div className="header-session-strip" aria-label="EQ session status">
              <span className="session-hide-mobile">{profileText}</span>
              <span>{activeBands}/{maxBands} bands</span>
              <span>{preampDb.toFixed(1)} dB preamp</span>
              {connected && <span className="session-hide-mobile">{supportsRamApply ? "Temporary apply available" : "Persistent writes only"}</span>}
            </div>
          )}
        </div>
        {/* Desktop Toolbar */}
        <div className="toolbar desktop-toolbar">
          {!isConfigPage && (
            <div className="history-buttons" aria-label="Edit history">
              <button
                type="button"
                className="history-btn"
                title="Undo"
                aria-label="Undo"
                disabled={isBusy || !canUndo}
                onClick={onUndo}
              >
                <Icon>undo</Icon>
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
                <Icon>redo</Icon>
                <span className="history-btn-label">Redo</span>
              </button>
            </div>
          )}
          {connected ? (
            <>
              {showDeviceEditorActions && (
                <>
                  <button className="btn" title="Replace the editor with EQ read from the DAC" onClick={onPull} disabled={isBusy}>Read DAC</button>
                  <button className={`btn${deviceMatchesEditor === false ? " warning" : ""}`} title="Store the editor EQ on the DAC" onClick={onPush} disabled={isBusy}>Write to DAC</button>
                </>
              )}
              <button className="btn" onClick={onDisconnect} disabled={isBusy}>Disconnect</button>
            </>
          ) : (
            <button className="btn filled" onClick={onConnectClick} disabled={isBusy}>
              <Icon>link</Icon>
              <span>Connect DAC</span>
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
              <Icon>undo</Icon>
            </button>
            <button
              type="button"
              className="history-btn"
              title="Redo"
              aria-label="Redo"
              disabled={isBusy || !canRedo}
              onClick={onRedo}
            >
              <Icon>redo</Icon>
            </button>
          </div>
          {connected ? (
            <>
              <button type="button" className="btn mobile-action-btn" title="Read EQ from DAC" onClick={onPull} disabled={isBusy}>Read DAC</button>
              <button type="button" className={`btn mobile-action-btn${deviceMatchesEditor === false ? " warning" : ""}`} title="Write EQ to DAC" onClick={onPush} disabled={isBusy}>Write DAC</button>
              <div className="mobile-menu-container" ref={menuRef}>
                <button
                  type="button"
                  className="mobile-more-btn"
                  title="More actions"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <Icon>more_vert</Icon>
                </button>
                {menuOpen && (
                  <div className="mobile-dropdown-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="dropdown-item danger"
                      onClick={() => {
                        onDisconnect();
                        setMenuOpen(false);
                      }}
                      disabled={isBusy}
                    >
                      <Icon>link_off</Icon>
                      <span>Disconnect</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button type="button" className="btn filled mobile-action-btn mobile-connect-btn" onClick={onConnectClick} disabled={isBusy}>
              <Icon>link</Icon>
              <span>Connect DAC</span>
            </button>
          )}
        </div>
      </div>
      {isBusy && (
        <div
          className="header-progress-bar"
          role="progressbar"
          aria-label={progress ? progress.message : "Device operation in progress"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ? Math.round(progress.percentage) : undefined}
        >
          <div
            className={`header-progress-fill ${progress ? "" : "indeterminate"}`}
            style={progress ? { transform: `scaleX(${Math.max(0, Math.min(100, progress.percentage)) / 100})` } : undefined}
          />
        </div>
      )}
    </header>
  );
});
