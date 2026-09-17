// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useState } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import {
  ActionRow,
  NavRow,
  SelectRow,
  StackHeader,
  ToggleRow,
} from "./SettingsPrimitives";
import { invoke } from "../lib/rpc";
import { isLinux, isTauri } from "../lib/platform";
import { LinuxUdevGuide, UDEV_INSTALL_COMMAND } from "./LinuxUdevGuide";
import type { SettingsSection } from "../lib/tabs";
import type { AppSettings, GraphViewMode } from "../types";

export const KEYBOARD_SHORTCUTS: [string, string][] = [
  ["Ctrl/⌘ Z", "Undo"],
  ["Ctrl/⌘ Shift Z", "Redo"],
  ["Ctrl/⌘ Y", "Redo"],
  ["Ctrl/⌘ S", "Save profile"],
  ["Ctrl/⌘ R", "Read EQ from DAC"],
  ["Ctrl/⌘ Shift R", "Reset EQ"],
  ["Ctrl/⌘ Enter", "Write EQ to DAC"],
];

const THEME_OPTIONS: { value: AppSettings["theme"]; label: string }[] = [
  { value: "auto", label: "Auto (System Theme)" },
  { value: "material-you", label: "System (Material You)" },
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "tokyo-night-storm", label: "Tokyo Night Storm" },
  { value: "tokyo-night-day", label: "Tokyo Night Day (Light)" },
  { value: "nord", label: "Nord" },
  { value: "dracula", label: "Dracula" },
  { value: "gruvbox", label: "Gruvbox Dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "catppuccin-latte", label: "Catppuccin Latte (Light)" },
];

interface UdevStatus {
  supported: boolean;
  installed: boolean;
  up_to_date: boolean;
  dest_path: string;
  has_pkexec: boolean;
}

export interface SettingsViewProps {
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  section?: SettingsSection;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  setStatus?: (value: string) => void;
  onUdevInstalled?: () => Promise<string | null>;
}

function UdevSection({
  setStatus,
  onUdevInstalled,
}: {
  setStatus?: (value: string) => void;
  onUdevInstalled?: () => Promise<string | null>;
}) {
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
          setCheckError(`Could not check USB permissions: ${error}`);
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [checkAttempt]);

  if (!isTauri()) {
    if (!isLinux()) return null;
    return (
      <section className="settings-plain" aria-label="Linux USB permissions">
        <h2 className="settings-plain-title">Linux USB permissions</h2>
        <LinuxUdevGuide setStatus={setStatus} />
      </section>
    );
  }

  if (checkError !== null) {
    return (
      <section className="settings-plain" aria-label="Linux USB permissions">
        <h2 className="settings-plain-title">Linux USB permissions</h2>
        <p className="settings-plain-desc" role="alert">{checkError}</p>
        <button type="button" className="btn" onClick={() => setCheckAttempt((attempt) => attempt + 1)}>
          <Icon>refresh</Icon>
          <span>Retry permissions check</span>
        </button>
        <p className="settings-plain-desc">
          On Linux, you can install the rule manually by running this command in a terminal, then reconnecting your DAC:
        </p>
        <div className="udev-command-row"><code>{UDEV_INSTALL_COMMAND}</code></div>
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
      title: update ? "Update USB permissions?" : "Install USB permissions?",
      message:
        "This requires administrator access (one password prompt) to install a udev rule to " +
        `${status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"} and reload udev. ` +
        "It installs no background services and can be removed here anytime.",
      confirmLabel: update ? "Update" : "Install",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setBusy("install");
    setNote("Installing permissions and detecting DAC…");
    try {
      await invoke("install_udev_rules");
      await refresh();
      if (onUdevInstalled) {
        const connectedName = await onUdevInstalled();
        if (connectedName) {
          setNote(`Permissions installed. Connected to ${connectedName}.`);
        } else {
          setNote("Permissions installed. Plug in your DAC and it will connect automatically.");
        }
      } else {
        setNote("Permissions installed.");
      }
    } catch (err) {
      const msg = `Failed to install udev rules: ${err}`;
      setNote(msg);
      setStatus?.(msg);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: "Remove USB permissions?",
      message:
        `This deletes ${status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}. ` +
        "You may need root permissions to access your DAC over USB until rules are reinstalled.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmed) return;
    setBusy("remove");
    setNote(null);
    try {
      await invoke("uninstall_udev_rules");
      await refresh();
      setNote("USB permissions removed.");
      setStatus?.("USB permissions removed.");
    } catch (err) {
      const msg = `Failed to remove udev rules: ${err}`;
      setNote(msg);
      setStatus?.(msg);
    } finally {
      setBusy(null);
    }
  };

  const installed = status?.installed === true;
  const current = status?.up_to_date === true;

  return (
    <section className="settings-plain" aria-label="Linux USB permissions">
      <div className="settings-plain-head">
        <h2 className="settings-plain-title">Linux USB permissions</h2>
        <span className={`status-pill ${installed ? (current ? "installed" : "outdated") : "missing"}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>
            {checking
              ? "Checking…"
              : !installed
                ? "Not Installed"
                : current
                  ? "Configured"
                  : "Update Available"}
          </span>
        </span>
      </div>

      <p className="settings-plain-desc">
        Linux restricts raw USB access by default. Installing a udev rule lets you access supported DACs without running Glacier EQ as root.
      </p>

      <div className="stack-pref-row">
        <div className="stack-pref-info">
          <span className="stack-pref-title">
            {installed ? (current ? "Permissions active" : "Rule update available") : "Install udev rule"}
          </span>
          <span className="stack-pref-desc">
            Target: <code>{status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}</code>
          </span>
        </div>
        <div className="stack-pref-control">
          <button
            type="button"
            className={`btn ${installed && current ? "" : "filled"}`}
            disabled={busy !== null || checking}
            onClick={handleInstall}
          >
            <Icon>{installed && current ? "refresh" : "add_moderator"}</Icon>
            <span>{busy === "install" ? "Working…" : installed ? (current ? "Reinstall" : "Update") : "Install"}</span>
          </button>
          {installed && (
            <button
              type="button"
              className="btn danger"
              disabled={busy !== null || checking}
              onClick={handleRemove}
            >
              <Icon>delete</Icon>
              <span>{busy === "remove" ? "Working…" : "Remove"}</span>
            </button>
          )}
        </div>
      </div>
      {note !== null && <p className="card-note" role="status">{note}</p>}
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
}: SettingsViewProps) {
  // Section select FIRST!
  if (section === "root") {
    return (
      <div className="stack-view settings-stack-view">
        <StackHeader title="Settings" />

        <nav className="stack-list settings-navigation" aria-label="Settings">
          <NavRow
            to="/settings/general"
            icon="tune"
            title="Behavior & audio"
            desc="Auto-pull EQ, frequency snapping, and graph preview"
          />

          <NavRow
            to="/settings/appearance"
            icon="palette"
            title="Interface & theme"
            desc="Color theme and graph view mode"
          />

          <NavRow
            to="/settings/diagnostics"
            icon="bug_report"
            title="Diagnostics & permissions"
            desc="Diagnostics log and Linux udev rules"
          />
        </nav>
      </div>
    );
  }

  // Subscreen with back button
  return (
    <div className="stack-view settings-stack-view">
      <StackHeader
        title={
          section === "general"
            ? "Behavior & audio"
            : section === "appearance"
              ? "Interface & theme"
              : "Diagnostics & permissions"
        }
        backTo="/settings"
        backLabel="Back to settings"
      />

      <div className="stack-content">
        {section === "general" && (
          <div className="stack-card">
            <ToggleRow
              title="Auto-pull EQ on connect"
              desc="Read EQ automatically when a DAC connects"
              checked={settings.auto_pull_on_connect}
              onChange={(v) => onSettingChange("auto_pull_on_connect", v)}
            />

            <ToggleRow
              title="Skip push verification"
              desc="Write faster by skipping readback verification"
              checked={settings.skip_push_verification}
              onChange={(v) => onSettingChange("skip_push_verification", v)}
            />

            <ToggleRow
              title="Snap frequency to ISO steps"
              desc="Snap frequency sliders and handles to standard 1/3-octave ISO steps"
              checked={settings.snap_to_iso_frequencies}
              onChange={(v) => onSettingChange("snap_to_iso_frequencies", v)}
            />

            <ToggleRow
              title="Floating graph preview"
              desc="Show a small graph preview when scrolling past filter bands"
              checked={settings.floating_graph_preview ?? true}
              onChange={(v) => onSettingChange("floating_graph_preview", v)}
            />

            {onShowGraphChange !== undefined && (
              <ToggleRow
                title="Show frequency response graph"
                desc="Show the frequency response graph above controls"
                checked={!!showGraph}
                onChange={onShowGraphChange}
              />
            )}
          </div>
        )}

        {section === "appearance" && (
          <div className="stack-card">
            <SelectRow<AppSettings["theme"]>
              id="theme-select"
              title="Color Theme"
              desc="Choose the app color scheme"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(val) => onSettingChange("theme", val)}
            />

            {graphViewMode && onGraphViewModeChange && (
              <div className="stack-pref-row">
                <div className="stack-pref-info">
                  <span className="stack-pref-title">Graph View Mode</span>
                  <span className="stack-pref-desc">
                    Shape normalizes curves at 1 kHz. Level shows absolute dB output.
                  </span>
                </div>
                <div className="stack-pref-control">
                  <div className="graph-view-toggle" role="group" aria-label="Graph view mode">
                    <button
                      type="button"
                      className={graphViewMode === "shape" ? "active" : ""}
                      aria-pressed={graphViewMode === "shape"}
                      onClick={() => onGraphViewModeChange("shape")}
                    >
                      Shape
                    </button>
                    <button
                      type="button"
                      className={graphViewMode === "level" ? "active" : ""}
                      aria-pressed={graphViewMode === "level"}
                      onClick={() => onGraphViewModeChange("level")}
                    >
                      Level
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "diagnostics" && (
          <>
            <UdevSection setStatus={setStatus} onUdevInstalled={onUdevInstalled} />

            <div className="stack-card">
              {onOpenDiagnostics && (
                <ActionRow
                  title="Diagnostics Log"
                  desc="View USB traffic, connection events, and driver logs"
                  actionLabel="View Logs"
                  icon="terminal"
                  onAction={onOpenDiagnostics}
                />
              )}
            </div>

            <section className="shortcuts-card settings-plain" aria-label="Keyboard shortcuts">
              <h2 className="settings-plain-title">Keyboard shortcuts</h2>
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
      </div>
    </div>
  );
});
