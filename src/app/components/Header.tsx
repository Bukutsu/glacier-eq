import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { memo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ToastContainer } from "@/components/feedback/Toast";
import type { OperationProgress } from "@/types";

function ConnectionActions({
  isBusy,
  onDisconnect,
  onPull,
  compact = false,
}: {
  isBusy: boolean;
  onDisconnect: () => void;
  onPull?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation("shell");
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("header.deviceActions")}
        render={
          <Button
            size={compact ? "icon" : "default"}
            className={compact ? "mobile-more-btn" : ""}
          />
        }
      >
        {compact ? (
          <Icon name="more_vert" />
        ) : (
          <>
            {t("navigation.device")} <Icon name="expand_more" />
          </>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          positionMethod="fixed"
          className="ui-popup-positioner"
        >
          <Menu.Popup
            className="ui-menu"
            aria-label={t("header.deviceActions")}
          >
            {onPull && (
              <Menu.Item
                className="ui-menu-item"
                disabled={isBusy}
                onClick={onPull}
              >
                <Icon name="file_download" /> {t("header.read")}
              </Menu.Item>
            )}
            <Menu.Item
              className="ui-menu-item"
              disabled={isBusy}
              onClick={onDisconnect}
            >
              <Icon name="link_off" /> {t("header.disconnectDac")}
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
  /** Live apply is on and working for the connected DAC. */
  liveApply?: boolean;
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
  liveApply = false,
  onExportEq,
  onDisconnect,
  onConnectClick,
  configPage,
  pageTitle: pageTitleOverride,
  mobile = false,
  compact = false,
  draftRecovery,
}: HeaderProps) {
  const { t } = useTranslation("shell");
  const isConfigPage = configPage !== undefined;
  const pageTitle =
    pageTitleOverride ??
    (configPage === "device"
      ? t("navigation.device")
      : configPage === "settings"
        ? t("navigation.settings")
        : profile);

  // With live apply the app saves in the background, so there is no write step.
  const liveSaves = liveApply && connected && hardwareEq && !isSimulated;
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
    ? t("header.offline")
    : isBusy
      ? progress
        ? t("header.progress", {
            message: progress.message,
            percentage: Math.round(progress.percentage),
          })
        : t("header.working")
      : isSimulated
        ? t("header.simulation")
        : !hardwareEq
          ? t("header.noHardwareExport")
          : deviceMatchesEditor === null
            ? t("header.unknown")
            : deviceMatchesEditor
              ? t("header.matches")
              : liveSaves
                ? t("header.live")
                : t("header.unwritten");
  const profileText = !profileSaved
    ? t("header.profileUnsaved")
    : profileDirty
      ? t("header.profileModified")
      : t("header.profileSaved");
  const writeVariant =
    deviceMatchesEditor === false && !isSimulated ? "primary" : "default";
  const mobileSyncText = !connected
    ? t("header.offlineEditing")
    : isBusy
      ? syncText
      : isSimulated
        ? t("header.simulatedDevice")
        : !hardwareEq
          ? t("header.noHardware")
          : deviceMatchesEditor === true
            ? t("header.saved")
            : deviceMatchesEditor === false
              ? liveSaves
                ? t("header.saveOnPause")
                : t("header.notSaved")
              : t("header.readToCheck");

  const exportButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="history-btn"
      title={t("header.export")}
      aria-label={t("header.export")}
      disabled={isBusy}
      onClick={onExportEq}
    >
      <Icon name="ios_share" />
    </Button>
  );

  return (
    <header
      className={`app-header${compact ? " compact-mobile" : ""}`}
      inert={inert}
    >
      <div className="header-main">
        <div className="title-stack">
          <div className="title-line">
            <h1>{pageTitle}</h1>
          </div>
          {/* One status line: DAC, sync state, and the profile. Device and
              Settings show status in their own content and the sidebar. */}
          {(mobile || !isConfigPage) && (
            <div className="header-meta-row">
              <span
                className={`sync-dot ${syncClass}`}
                role="status"
                aria-live="polite"
              >
                {mobile ? mobileSyncText : syncText}
              </span>
              {liveApply && connected && hardwareEq && !isConfigPage && (
                <span
                  className="header-profile-state"
                  title={t("header.liveApplyHelp")}
                >
                  {t("header.liveApply")}
                </span>
              )}
              {!isConfigPage && !mobile && (
                <span className="header-profile-state">{profileText}</span>
              )}
              {draftRecovery}
            </div>
          )}
        </div>
        {/* Desktop toolbar. EQ actions stay on EQ pages; Disconnect shows on
            every page except Device, whose card has its own. */}
        {!mobile &&
          (!isConfigPage || (connected && configPage !== "device")) && (
            <div className="toolbar desktop-toolbar">
              {!isConfigPage && (
                <>
                  <div
                    className="history-buttons"
                    role="group"
                    aria-label={t("header.editHistory")}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="history-btn"
                      title={t("actions.undo")}
                      aria-label={t("actions.undo")}
                      disabled={isBusy || !canUndo}
                      onClick={onUndo}
                    >
                      <Icon name="undo" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="history-btn"
                      title={t("actions.redo")}
                      aria-label={t("actions.redo")}
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
                        <Button
                          type="button"
                          variant="default"
                          title={t("header.readHelp")}
                          onClick={onPull}
                          disabled={isBusy}
                        >
                          {t("header.read")}
                        </Button>
                        {!liveSaves && (
                          <Button
                            type="button"
                            variant={writeVariant}
                            title={t("header.writeHelp")}
                            onClick={onPush}
                            disabled={isBusy}
                          >
                            {t("header.write")}
                          </Button>
                        )}
                      </>
                    )
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={onConnectClick}
                      disabled={isBusy}
                    >
                      <Icon name="link" />
                      <span>{t("actions.connect")}</span>
                    </Button>
                  )}
                </>
              )}
              {connected && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onDisconnect}
                  disabled={isBusy}
                >
                  <Icon name="link_off" />
                  <span>{t("actions.disconnect")}</span>
                </Button>
              )}
            </div>
          )}

        {/* Keep the write action visible; less frequent device actions live in the menu. */}
        {mobile && (
          <div className="mobile-toolbar">
            <div
              className="history-buttons mobile-history-buttons"
              role="group"
              aria-label={t("header.eqActions")}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="history-btn"
                title={t("actions.undo")}
                aria-label={t("actions.undo")}
                disabled={isBusy || !canUndo}
                onClick={onUndo}
              >
                <Icon name="undo" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="history-btn"
                title={t("actions.redo")}
                aria-label={t("actions.redo")}
                disabled={isBusy || !canRedo}
                onClick={onRedo}
              >
                <Icon name="redo" />
              </Button>
              {exportButton}
            </div>
            {connected ? (
              <>
                {hardwareEq && !liveSaves && (
                  <Button
                    type="button"
                    variant={writeVariant}
                    className="mobile-action-btn"
                    title={t("header.saveHelp")}
                    onClick={onPush}
                    disabled={isBusy}
                  >
                    <Icon name="save" /> {t("header.save")}
                  </Button>
                )}
                <ConnectionActions
                  isBusy={isBusy}
                  onDisconnect={onDisconnect}
                  onPull={hardwareEq ? onPull : undefined}
                  compact
                />
              </>
            ) : (
              <Button
                type="button"
                variant="default"
                className="mobile-action-btn mobile-connect-btn"
                onClick={onConnectClick}
                disabled={isBusy}
              >
                <Icon name="link" />
                <span>{t("actions.connect")}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      {connected && !hardwareEq && !isConfigPage && (
        <p className="header-eq-note" role="note">
          <Icon name="info" />
          <span>{t("header.noHardwareNote")}</span>
        </p>
      )}
      <ToastContainer errorsOnly />
      {isBusy && (
        <div
          className="header-progress-bar"
          role="progressbar"
          aria-label={
            progress ? progress.message : t("header.operationProgress")
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ? Math.round(progress.percentage) : undefined}
        >
          <div
            className={`header-progress-fill ${progress ? "" : "indeterminate"}`}
            style={
              progress
                ? {
                    transform: `scaleX(${Math.max(0, Math.min(100, progress.percentage)) / 100})`,
                  }
                : undefined
            }
          />
        </div>
      )}
    </header>
  );
});
