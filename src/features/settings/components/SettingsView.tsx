// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSetting } from "./LanguageSetting";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfigurationLayout } from "@/components/layout/ConfigurationLayout";
import { SETTINGS_SECTIONS } from "@/lib/tabs";
import {
  ActionRow,
  ExternalLinkRow,
  SegmentedRow,
  SelectRow,
  StackHeader,
  ToggleRow,
} from "@/components/ui/SettingsPrimitives";
import { invoke } from "@/lib/rpc";
import { isAndroidDevice, isLinux, isTauri } from "@/lib/platform";
import { themeOptions } from "@/features/settings/lib/theme";
import { ThemePicker } from "./ThemePicker";
import { UpdateSection } from "./UpdateSection";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  LinuxUdevGuide,
  UDEV_INSTALL_COMMAND,
} from "@/features/device/components/LinuxUdevGuide";
import type { SettingsSection } from "@/lib/tabs";
import type { AppSettings, GraphViewMode } from "@/types";

// Material You reads the Android system palette, so it is offered only there.
// Elsewhere it was listed, accepted, and then silently ignored: useThemeSync
// matched the value on any platform, failed to get a palette off Tauri, and
// fell back to Tokyo Night — so the user picked a theme and got a different
// one with no explanation.

interface UdevStatus {
  supported: boolean;
  installed: boolean;
  up_to_date: boolean;
  package_managed: boolean;
  dest_path: string;
  has_pkexec: boolean;
}

export interface SettingsViewProps {
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  section?: SettingsSection;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  setStatus?: (value: string) => void;
  onUdevInstalled?: () => Promise<string | null>;
  /** The connected DAC can take temporary EQ writes (live apply). */
  liveApplySupported?: boolean;
}

function UdevSection({
  setStatus,
  onUdevInstalled,
}: {
  setStatus?: (value: string) => void;
  onUdevInstalled?: () => Promise<string | null>;
}) {
  const { t } = useTranslation("settings");
  const [status, setUdevStatus] = useState<UdevStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [busy, setBusy] = useState<"install" | "remove" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setChecking(false);
      // Web builds cannot escalate privileges (no polkit), so there is no
      // daemon status to query — the manual guide below is the whole flow.
      return;
    }
    let cancelled = false;
    setChecking(true);
    setCheckError(null);
    invoke<UdevStatus>("get_udev_status")
      .then((next) => {
        if (!cancelled) {
          setUdevStatus(next);
          setChecking(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCheckError(t("permissions.checkFailed", { error: String(error) }));
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [checkAttempt, t]);

  if (!isTauri()) {
    if (!isLinux()) return null;
    return (
      <section className="settings-plain" aria-label={t("permissions.title")}>
        <h2 className="settings-plain-title">{t("permissions.title")}</h2>
        <LinuxUdevGuide setStatus={setStatus} />
      </section>
    );
  }

  if (checkError !== null) {
    return (
      <section className="settings-plain" aria-label={t("permissions.title")}>
        <h2 className="settings-plain-title">{t("permissions.title")}</h2>
        <p className="settings-plain-desc" role="alert">
          {checkError}
        </p>
        <Button
          type="button"
          onClick={() => setCheckAttempt((attempt) => attempt + 1)}
        >
          <Icon name="refresh" />
          <span>{t("permissions.retry")}</span>
        </Button>
        <p className="settings-plain-desc">{t("permissions.manualHelp")}</p>
        <div className="udev-command-row">
          <code>{UDEV_INSTALL_COMMAND}</code>
        </div>
      </section>
    );
  }

  if (!checking && status !== null && !status.supported) {
    return null;
  }

  const refresh = async () => {
    const next = await invoke<UdevStatus>("get_udev_status");
    setUdevStatus(next);
    return next;
  };

  const handleInstall = async () => {
    const update = status?.installed === true;
    const confirmed = await confirmDialog({
      title: update
        ? t("permissions.updateTitle")
        : t("permissions.installTitle"),
      message: t("permissions.installExplanation"),
      confirmLabel: update ? t("common.update") : t("common.install"),
      cancelLabel: t("common.cancel"),
    });
    if (!confirmed) return;
    setBusy("install");
    setNote(t("permissions.installing"));
    try {
      await invoke("install_udev_rules");
      await refresh();
      if (onUdevInstalled) {
        const connectedName = await onUdevInstalled();
        if (connectedName) {
          setNote(t("permissions.connected", { name: connectedName }));
        } else {
          setNote(t("permissions.installedConnect"));
        }
      } else {
        setNote(t("permissions.installed"));
      }
    } catch (err) {
      const msg = t("permissions.installFailed", { error: String(err) });
      setNote(msg);
      setStatus?.(msg);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (
      status?.package_managed &&
      status.dest_path === "/usr/lib/udev/rules.d/69-glacier-eq.rules"
    ) {
      setNote(t("permissions.packageManagedHelp"));
      setStatus?.(t("permissions.packageManaged"));
      return;
    }
    const confirmed = await confirmDialog({
      title: t("permissions.removeTitle"),
      message: t("permissions.removeExplanation", {
        path: status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules",
      }),
      confirmLabel: t("common.remove"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("remove");
    setNote(null);
    try {
      await invoke("uninstall_udev_rules");
      await refresh();
      setNote(t("permissions.removed"));
      setStatus?.(t("permissions.removed"));
    } catch (err) {
      const msg = t("permissions.removeFailed", { error: String(err) });
      setNote(msg);
      setStatus?.(msg);
    } finally {
      setBusy(null);
    }
  };

  const installed = status?.installed === true;
  const current = status?.up_to_date === true;

  return (
    <section className="settings-plain" aria-label={t("permissions.title")}>
      <div className="settings-plain-head">
        <h2 className="settings-plain-title">{t("permissions.title")}</h2>
        <Badge role="status">
          {checking
            ? t("common.checking")
            : !installed
              ? t("permissions.notInstalled")
              : current
                ? t("permissions.configured")
                : t("permissions.updateAvailable")}
        </Badge>
      </div>

      <p className="settings-plain-desc">{t("permissions.description")}</p>

      <div className="stack-pref-row">
        <div className="stack-pref-info">
          <span className="stack-pref-title">
            {installed
              ? current
                ? t("permissions.active")
                : t("permissions.ruleUpdate")
              : t("permissions.installRule")}
          </span>
          <span className="stack-pref-desc">
            {t("permissions.target")}{" "}
            <code>
              {status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}
            </code>
          </span>
        </div>
        <div className="stack-pref-control">
          <Button
            type="button"
            variant={installed && current ? "default" : "primary"}
            disabled={busy !== null || checking}
            onClick={handleInstall}
          >
            <Icon name={installed && current ? "refresh" : "add_moderator"} />
            <span>
              {busy === "install"
                ? t("common.working")
                : installed
                  ? current
                    ? t("common.reinstall")
                    : t("common.update")
                  : t("common.install")}
            </span>
          </Button>
          {installed &&
            !(
              status?.package_managed &&
              status.dest_path === "/usr/lib/udev/rules.d/69-glacier-eq.rules"
            ) && (
              <Button
                type="button"
                variant="danger"
                disabled={busy !== null || checking}
                onClick={handleRemove}
              >
                <Icon name="delete" />
                <span>
                  {busy === "remove" ? t("common.working") : t("common.remove")}
                </span>
              </Button>
            )}
        </div>
      </div>
      {note !== null && (
        <p className="card-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

export const SettingsView = memo(function SettingsView({
  settings,
  onSettingChange,
  section = "root",
  graphViewMode,
  onGraphViewModeChange,
  onOpenDiagnostics,
  showGraph,
  onShowGraphChange,
  setStatus,
  onUdevInstalled,
  liveApplySupported,
}: SettingsViewProps) {
  const { t } = useTranslation("settings");
  const KEYBOARD_SHORTCUTS: [string, string][] = [
    ["Ctrl/⌘ Z", t("shortcuts.undo")],
    ["Ctrl/⌘ Shift Z", t("shortcuts.redo")],
    ["Ctrl/⌘ Y", t("shortcuts.redo")],
    ["Ctrl/⌘ S", t("shortcuts.saveProfile")],
    ["Ctrl/⌘ R", t("shortcuts.read")],
    ["Ctrl/⌘ Shift R", t("shortcuts.reset")],
    ["Ctrl/⌘ Enter", t("shortcuts.write")],
  ];
  const mobile = useIsMobile();
  const THEME_OPTIONS = themeOptions(isAndroidDevice());
  const activeSection = section === "root" ? "general" : section;
  const sectionTitle =
    activeSection === "general"
      ? t("sections.general")
      : activeSection === "appearance"
        ? t("sections.appearance")
        : activeSection === "diagnostics"
          ? t("sections.diagnostics")
          : t("sections.about");
  const sectionValues = {
    general: t("general.summary", {
      autoRead: settings.auto_pull_on_connect
        ? t("common.on")
        : t("common.off"),
      verification: settings.skip_push_verification
        ? t("common.off")
        : t("common.on"),
    }),
    appearance: THEME_OPTIONS.find((option) => option.value === settings.theme)
      ?.label,
  };
  const sections = SETTINGS_SECTIONS.map((item) => ({
    ...item,
    label:
      item.id === "general"
        ? t("sections.general")
        : item.id === "appearance"
          ? t("sections.appearance")
          : item.id === "diagnostics"
            ? t("sections.diagnostics")
            : item.label,
  }));

  return (
    <ConfigurationLayout
      kind="settings"
      active={activeSection}
      root={section === "root"}
      sections={sections}
      sectionValues={sectionValues}
      sectionTitle={sectionTitle}
    >
      {!mobile && (
        <StackHeader
          title={
            activeSection === "general"
              ? t("sections.generalTitle")
              : activeSection === "appearance"
                ? t("sections.appearanceTitle")
                : activeSection === "diagnostics"
                  ? t("sections.diagnosticsTitle")
                  : t("sections.about")
          }
        />
      )}

      <p className="configuration-description">{t("savedAutomatically")}</p>
      <div className="stack-content">
        {activeSection === "general" && (
          <div className="stack-card">
            <LanguageSetting setStatus={setStatus} />
            <ToggleRow
              title={t("general.autoRead")}
              desc={t("general.autoReadDescription")}
              checked={settings.auto_pull_on_connect}
              onChange={(v) => onSettingChange("auto_pull_on_connect", v)}
            />

            <ToggleRow
              title={t("general.verify")}
              desc={t("general.verifyDescription")}
              checked={!settings.skip_push_verification}
              onChange={(v) => onSettingChange("skip_push_verification", !v)}
            />

            <ToggleRow
              title={t("general.liveApply")}
              desc={
                liveApplySupported
                  ? t("general.liveApplyDescription")
                  : t("general.liveApplyUnavailable")
              }
              checked={settings.live_apply}
              disabled={!liveApplySupported}
              onChange={(v) => onSettingChange("live_apply", v)}
            />

            <ToggleRow
              title={t("general.snapFrequency")}
              desc={t("general.snapFrequencyDescription")}
              checked={settings.snap_to_iso_frequencies}
              onChange={(v) => onSettingChange("snap_to_iso_frequencies", v)}
            />

            <ToggleRow
              title={t("general.floatingGraph")}
              desc={t("general.floatingGraphDescription")}
              checked={settings.floating_graph_preview ?? true}
              onChange={(v) => onSettingChange("floating_graph_preview", v)}
            />

            {onShowGraphChange !== undefined && (
              <ToggleRow
                title={t("general.showGraph")}
                desc={t("general.showGraphDescription")}
                checked={!!showGraph}
                onChange={onShowGraphChange}
              />
            )}
          </div>
        )}

        {activeSection === "appearance" && (
          <div className="stack-card">
            {mobile ? (
              <ThemePicker
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={(value) => onSettingChange("theme", value)}
              />
            ) : (
              <SelectRow<AppSettings["theme"]>
                id="theme-select"
                title={t("appearance.colorTheme")}
                desc={t("appearance.colorThemeDescription")}
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={(val) => onSettingChange("theme", val)}
              />
            )}

            {graphViewMode && onGraphViewModeChange && (
              <SegmentedRow<GraphViewMode>
                title={t("appearance.graphMode")}
                desc={t("appearance.graphModeDescription")}
                value={graphViewMode}
                options={[
                  { value: "shape", label: t("appearance.shape") },
                  { value: "level", label: t("appearance.level") },
                ]}
                onChange={onGraphViewModeChange}
              />
            )}
          </div>
        )}

        {activeSection === "diagnostics" && (
          <>
            <UdevSection
              setStatus={setStatus}
              onUdevInstalled={onUdevInstalled}
            />

            <div className="stack-card">
              {onOpenDiagnostics && (
                <ActionRow
                  title={t("diagnostics.log")}
                  desc={t("diagnostics.logDescription")}
                  actionLabel={t("diagnostics.viewLog")}
                  icon="terminal"
                  onAction={onOpenDiagnostics}
                />
              )}
            </div>

            <section
              className="shortcuts-card settings-plain"
              aria-label={t("shortcuts.title")}
            >
              <h2 className="settings-plain-title">{t("shortcuts.title")}</h2>
              <div className="shortcut-list">
                {KEYBOARD_SHORTCUTS.map(([keys, action]) => (
                  <div className="shortcut-row" key={keys}>
                    <span className="shortcut-keys">{keys}</span>
                    <span className="shortcut-action">{action}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeSection === "about" && (
          <>
            <section className="settings-plain" aria-label={t("about.title")}>
              <h2 className="settings-plain-title">Glacier EQ</h2>
              <p className="settings-plain-desc">{t("about.description")}</p>
            </section>

            {isTauri() && <UpdateSection />}

            <dl className="device-spec-list">
              <div>
                <dt>{t("about.version")}</dt>
                <dd>
                  v
                  {typeof __APP_VERSION__ !== "undefined"
                    ? __APP_VERSION__
                    : "0.10.1"}
                </dd>
              </div>
              <div>
                <dt>{t("about.platform")}</dt>
                <dd>
                  {isTauri()
                    ? isAndroidDevice()
                      ? t("about.android")
                      : t("about.desktop")
                    : t("about.web")}
                </dd>
              </div>
              <div>
                <dt>{t("about.hardware")}</dt>
                <dd>Savitech SA9312L DSP</dd>
              </div>
              <div>
                <dt>{t("about.license")}</dt>
                <dd>GPL-3.0-only</dd>
              </div>
            </dl>

            <section className="settings-plain" aria-label={t("about.links")}>
              <h2 className="settings-plain-title">{t("about.links")}</h2>
              <div className="stack-list">
                <ExternalLinkRow
                  href="https://github.com/Bukutsu/glacier-eq"
                  icon="code"
                  title={t("about.source")}
                  desc={t("about.sourceDescription")}
                />
                <ExternalLinkRow
                  href="https://github.com/Bukutsu/glacier-eq/wiki/Supported-Devices"
                  icon="memory"
                  title={t("about.devices")}
                  desc={t("about.devicesDescription")}
                />
                <ExternalLinkRow
                  href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting"
                  icon="build"
                  title={t("about.troubleshooting")}
                  desc={t("about.troubleshootingDescription")}
                />
                <ExternalLinkRow
                  href="https://github.com/Bukutsu/glacier-eq/issues"
                  icon="bug_report"
                  title={t("about.reportIssue")}
                  desc={t("about.reportIssueDescription")}
                />
              </div>
            </section>

            <p className="card-note">{t("about.howItWorks")}</p>
          </>
        )}
      </div>
    </ConfigurationLayout>
  );
});
