import { memo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./ui/Button";
import { Icon } from "./Icon";
import { ToastContainer } from "./Toast";
import { OperationProgress } from "../types";

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
  profile: string;
  deviceName: string;
  profileDirty: boolean;
  profileSaved?: boolean;
  deviceMatchesEditor: boolean | null;
  hardwareEq: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPull: () => void;
  onPush: () => void;
  onExportEq: () => void;
  onDisconnect: () => void;
  onConnectClick?: () => void;
  configPage?: "device" | "settings";
  pageTitle?: string;
  mobile?: boolean;
  compact?: boolean;
  draftRecovery?: ReactNode;
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
  profileSaved = false,
  deviceMatchesEditor,
  hardwareEq,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPull,
  onPush,
  onExportEq,
  onDisconnect,
  onConnectClick,
  configPage,
  pageTitle: pageTitleOverride,
  mobile = false,
  compact = false,
  draftRecovery,
}: HeaderProps) {
  const isConfigPage = configPage !== undefined;
  const pageTitle = pageTitleOverride ?? (configPage === "device" ? "Device" : configPage === "settings" ? "Settings" : profile);

  const syncClass = !connected
    ? "offline"
    : isBusy
      ? "working"
      : isSimulated
        ? "simulation"
        : !hardwareEq || deviceMatchesEditor === null
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
        : !hardwareEq
          ? "This DAC has no hardware EQ · export the EQ to use it in a system equalizer"
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
    : !hardwareEq ? "This DAC has no hardware EQ"
    : deviceMatchesEditor === true ? "Saved to DAC"
    : deviceMatchesEditor === false ? "Changes not saved to DAC"
    : "Read EQ from the DAC to check its state";

  const exportButton = (
    <Button
      type="button"
      variant="ghost" size="icon" className="history-btn"
      title="Export EQ file"
      aria-label="Export EQ file"
      disabled={isBusy}
      onClick={onExportEq}
    >
      <Icon name="ios_share" />
    </Button>
  );

  return (
    <header className={`app-header${compact ? " compact-mobile" : ""}`} inert={inert}>
      <div className="header-main">
        <div className="title-stack">
          <div className="title-line">
            <h1>{pageTitle}</h1>
          </div>
          {/* One status line: DAC, sync state, and (on EQ pages) the profile. */}
          <div className="header-meta-row">
            {connected && !mobile && <div className="device-name">{deviceName}</div>}
            <span className={`sync-dot ${syncClass}`} role="status" aria-live="polite">{mobile ? mobileSyncText : syncText}</span>
            {!isConfigPage && !mobile && <span className="header-profile-state">{profileText}</span>}
            {draftRecovery}
          </div>
        </div>
        {/* Desktop toolbar; Device and Settings pages carry their own actions. */}
        {!mobile && !isConfigPage && <div className="toolbar desktop-toolbar">
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
          {exportButton}
          {connected ? (
            hardwareEq && (
              <>
                <Button type="button" variant="default" title="Replace the editor with EQ read from the DAC" onClick={onPull} disabled={isBusy}>Read from DAC</Button>
                <Button type="button" variant={writeVariant} title="Store the editor EQ on the DAC" onClick={onPush} disabled={isBusy}>Write to DAC</Button>
              </>
            )
          ) : (
            <Button type="button" variant="primary" onClick={onConnectClick} disabled={isBusy}>
              <Icon name="link" />
              <span>Connect DAC</span>
            </Button>
          )}
        </div>}

        {/* Keep the write action visible; less frequent device actions live in the menu. */}
        {mobile && <div className="mobile-toolbar">
          <div className="history-buttons mobile-history-buttons" role="group" aria-label="EQ actions">
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
            {exportButton}
          </div>
          {connected ? (
            <>
              {hardwareEq && <Button type="button" variant={writeVariant} className="mobile-action-btn" title="Store the editor EQ on the DAC. It stays saved after unplugging." onClick={onPush} disabled={isBusy}><Icon name="save" /> Save to DAC</Button>}
              <ConnectionActions isBusy={isBusy} onDisconnect={onDisconnect} onPull={hardwareEq ? onPull : undefined} compact />
            </>
          ) : (
            <Button type="button" variant="default" className="mobile-action-btn mobile-connect-btn" onClick={onConnectClick} disabled={isBusy}>
              <Icon name="link" />
              <span>Connect DAC</span>
            </Button>
          )}
        </div>}
      </div>
      <ToastContainer errorsOnly />
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
