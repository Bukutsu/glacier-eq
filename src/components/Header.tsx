import { memo } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./ui/Button";
import { Icon } from "./Icon";
import { OperationProgress } from "../types";
import { isTauri } from "../lib/platform";
import { useIsMobile } from "../hooks/useIsMobile";

const REPO_URL = "https://github.com/Bukutsu/glacier-eq";

function GithubLink() {
  const isMobile = useIsMobile();
  // CSS also hides the link on mobile; returning null keeps it out of the
  // keyboard tab order instead of leaving a focusable hidden element.
  if (isTauri() || isMobile) return null;

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

function ConnectionActions({ isBusy, onDisconnect, onPull, compact = false }: {
  isBusy: boolean;
  onDisconnect: () => void;
  onPull?: () => void;
  compact?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Device actions"
        render={<Button size={compact ? "icon" : "default"} className={compact ? "mobile-more-btn" : ""} />}
      >
        {compact ? <Icon name="more_vert" /> : <>Device <Icon name="expand_more" /></>}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} positionMethod="fixed" className="ui-popup-positioner">
          <Menu.Popup className="ui-menu" aria-label="Device actions">
            {onPull && (
              <Menu.Item className="ui-menu-item" disabled={isBusy} onClick={onPull}>
                <Icon name="file_download" /> Read from DAC
              </Menu.Item>
            )}
            <Menu.Item className="ui-menu-item" disabled={isBusy} onClick={onDisconnect}>
              <Icon name="link_off" /> Disconnect DAC
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

interface HeaderProps {
  inert?: boolean;
  connected: boolean;
  isSimulated?: boolean;
  isBusy: boolean;
  progress: OperationProgress | null;
  workspaceLabel?: string;
  profile: string;
  deviceName: string;
  profileDirty: boolean;
  profileSaved?: boolean;
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
  mobile?: boolean;
  compact?: boolean;
}

export const Header = memo(function Header({
  inert,
  connected,
  isSimulated = false,
  isBusy,
  progress,
  workspaceLabel,
  profile,
  deviceName,
  profileDirty,
  profileSaved = false,
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
  mobile = false,
  compact = false,
}: HeaderProps) {
  const isConfigPage = configPage !== undefined;
  const showDeviceEditorActions = !isConfigPage || configPage === "device";
  const pageTitle = pageTitleOverride ?? (configPage === "device" ? "Device" : configPage === "settings" ? "Settings" : profile);

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
    ? "Offline"
    : isBusy
      ? progress
        ? `${progress.message} · ${Math.round(progress.percentage)}%`
        : "Working"
      : isSimulated
        ? "Simulation · no hardware changes"
        : deviceMatchesEditor === null
          ? "Device state unknown"
          : deviceMatchesEditor
            ? "DAC: matches editor"
            : "DAC: changes not written";
  const profileText = !profileSaved
    ? "Profile: not saved"
    : profileDirty
      ? "Profile: modified"
      : "Profile: saved";
  const writeVariant = deviceMatchesEditor === false && !isSimulated ? "primary" : "default";
  const mobileSyncText = !connected ? "Offline editing"
    : isBusy ? syncText
    : isSimulated ? "Simulated device; no hardware changes"
    : deviceMatchesEditor === true ? "Saved to DAC"
    : deviceMatchesEditor === false ? "Changes not saved to DAC"
    : "Read EQ from the DAC to check its state";

  return (
    <header className={`app-header${compact ? " compact-mobile" : ""}`} inert={inert}>
      <div className="header-main">
        <div className="title-stack">
          {!mobile && workspaceLabel && <div className="workspace-heading">{workspaceLabel}</div>}
          <div className="title-line">
            <h1>{pageTitle}</h1>
            <GithubLink />
          </div>
          <div className="header-meta-row">
            {connected && !mobile && <div className="device-name">{deviceName}</div>}
            <span className={`sync-dot ${syncClass}`} role="status" aria-live="polite">{mobile ? mobileSyncText : syncText}</span>
          </div>
          {!isConfigPage && !mobile && (
            <div className="header-session-strip" role="group" aria-label="EQ session status">
              <span>{profileText}</span>
              <span>{activeBands}/{maxBands} bands</span>
              <span>{preampDb.toFixed(1)} dB preamp</span>
              {connected && <span className="session-hide-mobile">{supportsRamApply ? "Temporary EQ supported" : "Persistent writes only"}</span>}
            </div>
          )}
        </div>
        {/* Desktop Toolbar */}
        {!mobile && <div className="toolbar desktop-toolbar">
          {!isConfigPage && (
            <div className="history-buttons" role="group" aria-label="Edit history">
              <Button
                type="button"
                variant="ghost" size="icon" className="history-btn"
                title="Undo"
                aria-label="Undo"
                disabled={isBusy || !canUndo}
                onClick={onUndo}
              >
                <Icon name="undo" />
              </Button>
              <Button
                type="button"
                variant="ghost" size="icon" className="history-btn"
                title="Redo"
                aria-label="Redo"
                disabled={isBusy || !canRedo}
                onClick={onRedo}
              >
                <Icon name="redo" />
              </Button>
            </div>
          )}
          {connected ? (
            <>
              {showDeviceEditorActions && (
                <>
                  <Button type="button" variant="default" title="Replace the editor with EQ read from the DAC" onClick={onPull} disabled={isBusy}>Read from DAC</Button>
                  <Button type="button" variant={writeVariant} title="Store the editor EQ on the DAC" onClick={onPush} disabled={isBusy}>Write to DAC</Button>
                </>
              )}
              <ConnectionActions isBusy={isBusy} onDisconnect={onDisconnect} />
            </>
          ) : (
            <Button type="button" variant="primary" onClick={onConnectClick} disabled={isBusy}>
              <Icon name="link" />
              <span>Connect DAC</span>
            </Button>
          )}
        </div>}

        {/* Keep the write action visible; less frequent device actions live in the menu. */}
        {mobile && <div className="mobile-toolbar">
          <div className="history-buttons mobile-history-buttons" role="group" aria-label="Edit history">
            <Button
              type="button"
              variant="ghost" size="icon" className="history-btn"
              title="Undo"
              aria-label="Undo"
              disabled={isBusy || !canUndo}
              onClick={onUndo}
            >
              <Icon name="undo" />
            </Button>
            <Button
              type="button"
              variant="ghost" size="icon" className="history-btn"
              title="Redo"
              aria-label="Redo"
              disabled={isBusy || !canRedo}
              onClick={onRedo}
            >
              <Icon name="redo" />
            </Button>
          </div>
          {connected ? (
            <>
              <Button type="button" variant={writeVariant} className="mobile-action-btn" title="Store the editor EQ on the DAC. It stays saved after unplugging." onClick={onPush} disabled={isBusy}><Icon name="save" /> Save to DAC</Button>
              <ConnectionActions isBusy={isBusy} onDisconnect={onDisconnect} onPull={onPull} compact />
            </>
          ) : (
            <Button type="button" variant="default" className="mobile-action-btn mobile-connect-btn" onClick={onConnectClick} disabled={isBusy}>
              <Icon name="link" />
              <span>Connect DAC</span>
            </Button>
          )}
        </div>}
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
