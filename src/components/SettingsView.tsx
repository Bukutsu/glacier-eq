// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useState } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import {
  ActionRow,
  CategoryHeader,
  NavRow,
  SelectRow,
  StackHeader,
  ToggleRow,
} from "./SettingsPrimitives";
import { invoke } from "../lib/rpc";
import { isTauri } from "../lib/platform";
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
  const [busy, setBusy] = useState<"install" | "remove" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    invoke<UdevStatus>("get_udev_status")
      .then((next) => {
        if (!cancelled) {
          setUdevStatus(next);
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauri() || (!checking && (status === null || !status.supported))) {
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
        "This asks for administrator access (one system password prompt) to copy a single file to " +
        `${status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}, make it world-readable, ` +
        "and reload udev so your supported DACs work without extra prompts. It installs no services, " +
        "touches nothing else, and you can remove it from this same screen.",
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
          setNote(`Permissions installed. Seamlessly connected to ${connectedName}.`);
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
        `This will delete ${status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}. ` +
        "You may need root access to communicate with your DAC over USB until rules are reinstalled.",
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
    <section className="settings-card udev-card">
      <div className="settings-card-head">
        <div className="card-head-title">
          <Icon>security</Icon>
          <strong>Linux USB Permissions</strong>
        </div>
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

      <p className="card-desc">
        Linux restricts raw USB HID access to root by default. Installing a udev rule grants user permission for verified DACs without running Glacier EQ as root.
      </p>

      <div className="stack-pref-row">
        <div className="stack-pref-info">
          <span className="stack-pref-title">
            {installed ? (current ? "Permissions active" : "Permissions rule update available") : "Install udev rule"}
          </span>
          <span className="stack-pref-desc">
            Target: <code>{status?.dest_path ?? "/etc/udev/rules.d/69-glacier-eq.rules"}</code>
          </span>
        </div>
        <div className="stack-pref-control action-buttons">
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

        <div className="stack-list">
          <CategoryHeader title="Audio & Behavior" />
          <NavRow
            to="/settings/general"
            icon="tune"
            title="Behavior & Audio"
            desc="Auto-pull EQ, frequency snapping, graph preview"
          />

          <CategoryHeader title="Appearance" />
          <NavRow
            to="/settings/appearance"
            icon="palette"
            title="Interface & Theme"
            desc="Color theme, frequency graph view mode"
          />

          <CategoryHeader title="System" />
          <NavRow
            to="/settings/diagnostics"
            icon="bug_report"
            title="Diagnostics & Permissions"
            desc="USB communication logs, Linux udev rules"
          />
        </div>
      </div>
    );
  }

  // Subscreen with back button
  return (
    <div className="stack-view settings-stack-view">
      <StackHeader
        title={
          section === "general"
            ? "Behavior & Audio"
            : section === "appearance"
              ? "Interface & Theme"
              : "Diagnostics & Permissions"
        }
        backTo="/settings"
        backLabel="Back to settings"
      />

      <div className="stack-content">
        {section === "general" && (
          <div className="stack-card">
            <ToggleRow
              title="Auto-pull EQ on connect"
              desc="Automatically read on-board filter parameters whenever a DAC is connected"
              checked={settings.auto_pull_on_connect}
              onChange={(v) => onSettingChange("auto_pull_on_connect", v)}
            />

            <ToggleRow
              title="Skip push verification"
              desc="Transmit filter adjustments faster by skipping post-write readback verification"
              checked={settings.skip_push_verification}
              onChange={(v) => onSettingChange("skip_push_verification", v)}
            />

            <ToggleRow
              title="Snap frequency to ISO standard values"
              desc="Quantize slider and drag adjustments to standard 1/3-octave ISO frequencies"
              checked={settings.snap_to_iso_frequencies}
              onChange={(v) => onSettingChange("snap_to_iso_frequencies", v)}
            />

            <ToggleRow
              title="Floating graph preview while scrolling"
              desc="Display a miniature response curve thumbnail while scrolling down through filter bands"
              checked={settings.floating_graph_preview ?? true}
              onChange={(v) => onSettingChange("floating_graph_preview", v)}
            />

            {onShowGraphChange !== undefined && (
              <ToggleRow
                title="Show frequency response graph"
                desc="Display the interactive response curve and trace overlays above controls"
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
              desc="Select visual appearance and syntax palette"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(val) => onSettingChange("theme", val)}
            />

            {graphViewMode && onGraphViewModeChange && (
              <div className="stack-pref-row">
                <div className="stack-pref-info">
                  <span className="stack-pref-title">Graph View Mode</span>
                  <span className="stack-pref-desc">
                    Shape normalizes curve response to 1 kHz; Level plots absolute dB output across frequencies.
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
                  title="Live Diagnostics Event Log"
                  desc="Inspect USB packets, connection states, and background driver activity"
                  actionLabel="View Logs"
                  icon="terminal"
                  onAction={onOpenDiagnostics}
                />
              )}
            </div>

            <section className="settings-card shortcuts-card">
              <div className="settings-card-head">
                <div className="card-head-title">
                  <Icon>keyboard</Icon>
                  <strong>Keyboard Shortcuts</strong>
                </div>
                <span className="card-head-sub">Desktop hotkeys for rapid editing and syncing</span>
              </div>
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
