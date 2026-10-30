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
            className={compact ? "leg:compact:inline-flex leg:compact:items-center leg:compact:justify-center leg:compact:w-[44px] leg:compact:h-[44px] leg:compact:text-[color:var(--text)] leg:compact:[background:var(--surface-soft)] leg:compact:[outline:1px_solid_var(--line-soft)] leg:compact:[outline-offset:-1px] leg:compact:[&:active]:[background:var(--surface)]" : ""}
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
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
        >
          <Menu.Popup
            className="cmp:box-border cmp:max-h-[var(--available-height)] cmp:overflow-y-auto cmp:p-[var(--space-1)] cmp:[border:1px_solid_var(--line-medium)] cmp:rounded-[var(--radius-card)] cmp:[background:var(--popover)] cmp:text-[color:var(--popover-foreground)] cmp:[outline:none] cmp:min-w-[200px] cmp:[&&]:[border-color:var(--border)] cmp:[box-shadow:var(--shadow-sm)]"
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
  connected: boolean;
  /** The DAC was unplugged and the app is waiting for it to come back. */
  reconnecting?: boolean;
  isSimulated?: boolean;
  isBusy: boolean;
  progress: OperationProgress | null;
  profile: string;
  profileDirty: boolean;
  profileSaved?: boolean;
  /** A saved profile or Default EQ changed in the editor. */
  profileEdited?: boolean;
  deviceMatchesEditor: boolean | null;
  hardwareEq: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPull: () => void;
  onPush: () => void;
  /** Optional bank-specific label for the write action. */
  saveLabel?: string;
  /** Live RAM apply or preview is active. */
  liveApply?: boolean;
  /** Live apply persists to DAC flash, not just RAM. Defaults to liveApply. */
  liveApplySaves?: boolean;
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
  connected,
  reconnecting = false,
  isSimulated = false,
  isBusy,
  progress,
  profile,
  profileDirty,
  profileSaved = false,
  profileEdited = false,
  deviceMatchesEditor,
  hardwareEq,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPull,
  onPush,
  saveLabel,
  liveApply = false,
  liveApplySaves = liveApply,
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
  const liveSaves = liveApplySaves && connected && hardwareEq && !isSimulated;
  const syncClass = reconnecting
    ? "working"
    : !connected
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
  const syncText = reconnecting
    ? t("connection.reconnecting")
    : !connected
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
  const mobileSyncText = reconnecting
    ? t("connection.reconnecting")
    : !connected
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
      className="leg:[&:disabled]:[background:transparent]! leg:compact:[.mobile-history-buttons_&]:w-[44px] leg:compact:[.mobile-history-buttons_&]:min-w-[44px] leg:compact:[.mobile-history-buttons_&]:min-h-[44px] leg:compact:[.mobile-history-buttons_&]:p-[0] leg:compact:min-h-[40px]"
      title={t("header.export")}
      aria-label={t("header.export")}
      disabled={isBusy}
      onClick={onExportEq}
    >
      <Icon name="ios_share" />
    </Button>
  );

  return (
    <header className={`app-header${compact ? " compact-mobile" : ""}`}>
      <div className="header-main leg:min-w-[0] leg:flex leg:items-center leg:justify-between leg:flex-wrap leg:gap-[var(--space-4)] leg:max-[960px]:grid-cols-[minmax(0,_1fr)_auto] leg:max-[960px]:items-center leg:max-[960px]:gap-[12px] leg:compact:flex leg:compact:flex-wrap leg:compact:[&&]:items-center leg:compact:[&&]:gap-[8px] leg:compact:w-[100%] cmp:compact:[.app-header.compact-mobile:has(.toast-feedback)>&]:hidden cmp:compact:[.app-header_&]:gap-[var(--space-1)]">
        <div className="leg:flex leg:flex-col leg:gap-[6px] leg:min-w-[0] leg:max-[960px]:w-[100%] leg:compact:flex-[1_1_100%] leg:compact:min-w-[0] leg:compact:gap-[var(--space-1)] cmp:compact:[.app-header_&]:gap-[0]">
          <div className="title-line leg:flex leg:items-center leg:gap-[var(--space-2)] leg:min-w-[0] leg:max-[960px]:gap-[8px] leg:compact:flex-nowrap leg:compact:[&&]:gap-[6px]">
            <h1>{pageTitle}</h1>
            {mobile && !isConfigPage && profileEdited && (
              <span className="cmp:compact:flex-[none] cmp:compact:p-[1px_var(--space-2)] cmp:compact:[border:1px_solid_var(--border)] cmp:compact:rounded-[var(--radius-pill)] cmp:compact:text-[color:var(--muted-foreground)] cmp:compact:text-[length:var(--type-small)] cmp:compact:leading-[1.4]">{t("header.edited")}</span>
            )}
          </div>
          {/* One status line: DAC, sync state, and the profile. Device and
              Settings show status in their own content and the sidebar. */}
          {(mobile || !isConfigPage) && (
            <div className="leg:flex leg:items-center leg:gap-[var(--space-2)] leg:min-w-[0] leg:flex-wrap leg:compact:flex-row leg:compact:items-center leg:compact:gap-[8px] cmp:compact:[.app-header_&]:mt-[0]">
              <span
                className={`leg:inline-flex leg:items-center leg:gap-[6px] leg:max-w-[100%] leg:text-[length:var(--type-small)] leg:leading-[1.4] leg:text-[color:var(--muted)] leg:[&::before]:content-[''] leg:[&::before]:w-[5px] leg:[&::before]:h-[5px] leg:[&::before]:flex-[0_0_5px] leg:[&::before]:rounded-[var(--radius-pill)] leg:[&::before]:[background:currentColor] leg:[&.ok]:text-[color:var(--sync-ok)] leg:[&&.simulation]:text-[color:var(--sync-working)] leg:[&&&.working]:text-[color:var(--sync-working)] leg:[&&&&.unsaved]:text-[color:var(--sync-unsaved)] leg:compact:min-h-[24px] leg:compact:inline-flex leg:compact:items-center ${syncClass}`}
                role="status"
                aria-live="polite"
              >
                {mobile ? mobileSyncText : syncText}
              </span>
              {liveApply && connected && hardwareEq && !isConfigPage && (
                <span
                  className="leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.4] leg:[&::before]:content-['·'] leg:[&::before]:mr-[var(--space-2)]"
                  title={t("header.liveApplyHelp")}
                >
                  {t("header.liveApply")}
                </span>
              )}
              {!isConfigPage && !mobile && (
                <span className="leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.4] leg:[&::before]:content-['·'] leg:[&::before]:mr-[var(--space-2)]">{profileText}</span>
              )}
              {draftRecovery}
            </div>
          )}
        </div>
        {/* Desktop toolbar. EQ actions stay on EQ pages; Disconnect shows on
            every page except Device, whose card has its own. */}
        {!mobile &&
          (!isConfigPage || (connected && configPage !== "device")) && (
            <div className="toolbar leg:compact:hidden!">
              {!isConfigPage && (
                <>
                  <div
                    className="leg:inline-flex leg:gap-[var(--space-1)] leg:compact:flex-[none]"
                    role="group"
                    aria-label={t("header.editHistory")}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="leg:[&:disabled]:[background:transparent]! leg:compact:[.mobile-history-buttons_&]:w-[44px] leg:compact:[.mobile-history-buttons_&]:min-w-[44px] leg:compact:[.mobile-history-buttons_&]:min-h-[44px] leg:compact:[.mobile-history-buttons_&]:p-[0] leg:compact:min-h-[40px]"
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
                      className="leg:[&:disabled]:[background:transparent]! leg:compact:[.mobile-history-buttons_&]:w-[44px] leg:compact:[.mobile-history-buttons_&]:min-w-[44px] leg:compact:[.mobile-history-buttons_&]:min-h-[44px] leg:compact:[.mobile-history-buttons_&]:p-[0] leg:compact:min-h-[40px]"
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
                            title={saveLabel ?? t("header.writeHelp")}
                            onClick={onPush}
                            disabled={isBusy}
                          >
                            {saveLabel ?? t("header.write")}
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
          <div className="mobile-toolbar leg:hidden leg:compact:flex leg:compact:items-center leg:compact:gap-[8px] leg:compact:w-[100%]">
            {!isConfigPage && (
              <div
                className="leg:inline-flex leg:gap-[var(--space-1)] leg:compact:flex-[none] mobile-history-buttons leg:compact:mr-[auto] leg:compact:[background:transparent] leg:compact:[outline:none] leg:compact:p-[0]"
                role="group"
                aria-label={t("header.eqActions")}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="leg:[&:disabled]:[background:transparent]! leg:compact:[.mobile-history-buttons_&]:w-[44px] leg:compact:[.mobile-history-buttons_&]:min-w-[44px] leg:compact:[.mobile-history-buttons_&]:min-h-[44px] leg:compact:[.mobile-history-buttons_&]:p-[0] leg:compact:min-h-[40px]"
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
                  className="leg:[&:disabled]:[background:transparent]! leg:compact:[.mobile-history-buttons_&]:w-[44px] leg:compact:[.mobile-history-buttons_&]:min-w-[44px] leg:compact:[.mobile-history-buttons_&]:min-h-[44px] leg:compact:[.mobile-history-buttons_&]:p-[0] leg:compact:min-h-[40px]"
                  title={t("actions.redo")}
                  aria-label={t("actions.redo")}
                  disabled={isBusy || !canRedo}
                  onClick={onRedo}
                >
                  <Icon name="redo" />
                </Button>
                {exportButton}
              </div>
            )}
            {connected ? (
              <>
                {hardwareEq && !liveSaves && !isConfigPage && (
                  <Button
                    type="button"
                    variant={writeVariant}
                    className="mobile-action-btn leg:compact:min-h-[44px] leg:compact:p-[0_14px] leg:compact:[outline:1px_solid_var(--line-soft)] leg:compact:[outline-offset:-1px] leg:compact:[&&]:flex-[1_1_0] leg:compact:[&&]:min-w-[0] leg:compact:[&&]:px-[8px]"
                    title={saveLabel ?? t("header.saveHelp")}
                    onClick={onPush}
                    disabled={isBusy}
                  >
                    <Icon name="save" /> {saveLabel ?? t("header.save")}
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
                className="mobile-action-btn leg:compact:min-h-[44px] leg:compact:p-[0_14px] leg:compact:[outline:1px_solid_var(--line-soft)] leg:compact:[outline-offset:-1px] leg:compact:[&&]:flex-[1_1_0] leg:compact:[&&]:min-w-[0] leg:compact:[&&]:px-[8px] leg:compact:flex-[1_1_auto] leg:compact:min-w-[0] cmp:compact:[.mobile-toolbar_&]:flex-[0_0_auto] cmp:compact:[.mobile-toolbar_&]:ml-[auto]"
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
        <p className="header-eq-note leg:flex leg:items-start leg:gap-[var(--space-2)] leg:max-w-[680px] leg:m-[var(--space-3)_0_0] leg:text-[color:var(--muted-foreground)] leg:text-[length:var(--type-small)] leg:leading-[1.5]" role="note">
          <Icon name="info" />
          <span>{t("header.noHardwareNote")}</span>
        </p>
      )}
      <ToastContainer quiet />
      {isBusy && (
        <div
          className="leg:absolute leg:bottom-[-1px] leg:left-[0] leg:w-[100%] leg:h-[2px] leg:[background:var(--surface-soft)] leg:overflow-hidden"
          role="progressbar"
          aria-label={
            progress ? progress.message : t("header.operationProgress")
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ? Math.round(progress.percentage) : undefined}
        >
          <div
            className={`leg:w-[100%] leg:h-[100%] leg:[transform-origin:left] leg:[background:var(--primary)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[&.indeterminate]:w-[40%] leg:[&.indeterminate]:[animation:indeterminate-slide_1.4s_ease-in-out_infinite] ${progress ? "" : "indeterminate"}`}
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
