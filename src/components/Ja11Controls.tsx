// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { invoke, invokeForDevice } from "../lib/rpc";
import { isDevDummyDevice } from "../lib/devDevice";
import { confirmDialog } from "./ConfirmDialog";
import { Button } from "./ui/Button";
import { Icon } from "./Icon";
import { SegmentedRow } from "./SettingsPrimitives";
import { Switch } from "./ui/Switch";
import { Slider } from "./Slider";
import type { StatusReporter } from "../stores/toastStore";

// Credits: Cyfine/ja11-web-control app.js updateVolumeDraft/applyDeviceVolume
// keeps adjustments local until Apply, then verifies the device readback:
// https://github.com/Cyfine/ja11-web-control/blob/4d4eb83df6fcdf9e20b52e1bdf59a77f463b2c30/app.js#L544-L575
// Glacier's UI applies selections immediately and debounces slider writes;
// it retains Cyfine's extra confirmation for increases above 10 steps.
// Wire format/source provenance lives in the Rust JA11 control codec.
export const JA11_CONTROLS = [
  { key: "microphone", max: 1 },
  { key: "uac", max: 1 },
  { key: "volume", max: 60 },
] as const;

// Diagnostic failures must not affect hardware operations or trigger retries.
function diagnostic(control: string, target: number, outcome: string) {
  void invoke("add_diagnostic_event", {
    level: "Info", source: "Device", message: `JA11 ${control} target=${target}: ${outcome}`,
  }).catch(() => {});
}

type Field = { value: number | null; draft: number | null; error: string | null };
export function Ja11Controls({ path, isBusy, setStatus, onExpectedDisconnect }: {
  path: string; isBusy: boolean; setStatus: StatusReporter;
  /** Lets the app treat a brief USB drop after a write as expected, not an error. */
  onExpectedDisconnect?: () => void;
}) {
  const simulated = isDevDummyDevice(path);
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [working, setWorking] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const blocked = useRef(isBusy);
  blocked.current = isBusy;
  const running = useRef(false);

  const refresh = async (token = generation.current) => {
    if (running.current || blocked.current) return;
    running.current = true;
    setWorking(true);
    for (const { key } of JA11_CONTROLS) {
      if (token !== generation.current || blocked.current) break;
      // Clear each field first: a failed read never leaves an editable default.
      setFields(old => ({ ...old, [key]: { value: null, draft: null, error: null } }));
      try {
        const value = await invokeForDevice<number>(path, "ja11_control", { path, control: key });
        if (token !== generation.current) return;
        setFields(old => ({ ...old, [key]: { value, draft: value, error: null } }));
      } catch (error) {
        if (token !== generation.current) return;
        setFields(old => ({ ...old, [key]: { value: null, draft: null, error: String(error) } }));
      }
    }
    if (token === generation.current) { running.current = false; setWorking(false); }
  };

  useEffect(() => {
    const token = ++generation.current;
    setFields({});
    running.current = false;
    void refresh(token);
    return () => {
      ++generation.current;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [path]);

  const apply = async (key: string, target: number) => {
    const field = fields[key];
    if (blocked.current || running.current || field?.value == null || target === field.value) return;
    const token = generation.current;
    running.current = true;
    setWorking(true);
    try {
      // Preserve hearing-safety confirmation for a large increase, not every step.
      if (key === "volume" && target > field.value + 10) {
        const confirmed = await confirmDialog({
          title: "Increase output volume?",
          message: `Increase output volume from ${field.value} to ${target}/60? Lower your system volume first.`,
          confirmLabel: "Increase volume",
        });
        if (token !== generation.current) return;
        if (!confirmed) {
          setFields(old => ({ ...old, [key]: { ...old[key], draft: old[key].value } }));
          return;
        }
      }
      if (token !== generation.current || blocked.current) return;
      onExpectedDisconnect?.();
      diagnostic(key, target, "sending once");
      const actual = await invokeForDevice<number | null>(path, "ja11_control", { path, control: key, value: target });
      diagnostic(key, target, actual === null
        ? "sent-unverified: readback timeout, disconnect, or mismatch"
        : "verified by readback");
      if (token !== generation.current) return;
      if (actual === null) {
        const message = `Sent ${target}, not verified (readback missing or different). Refresh settings to check; reconnect only if the device disconnected.`;
        setFields(old => ({ ...old, [key]: { value: null, draft: target, error: message } }));
        setStatus(`JA11 ${key}: ${message}`);
      } else {
        setFields(old => ({ ...old, [key]: { value: actual, draft: actual, error: null } }));
        // Keep successful background updates quiet; field state shows completion.
      }
    } catch (error) {
      diagnostic(key, target, `outcome unknown: ${error}`);
      if (token === generation.current) {
        // A transport error can happen after delivery. Never claim rollback.
        setFields(old => ({ ...old, [key]: { value: null, draft: target, error: `Outcome unknown for target ${target}: ${error}. Refresh settings to check.` } }));
        setStatus(`Could not verify JA11 ${key}; outcome unknown. Refresh settings to check: ${error}`);
      }
    } finally {
      if (token === generation.current) { running.current = false; setWorking(false); }
    }
  };

  const change = (key: string, target: number) => {
    const control = JA11_CONTROLS.find(control => control.key === key);
    if (!control || blocked.current || running.current || fields[key]?.value == null ||
        !Number.isInteger(target) || target < 0 || target > control.max) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setFields(old => ({ ...old, [key]: { ...old[key], draft: target, error: null } }));
    if (key === "volume") {
      setScheduled(true);
      // Only the latest slider position is sent after the user pauses.
      timer.current = setTimeout(() => {
        timer.current = null;
        setScheduled(false);
        void apply(key, target);
      }, 350);
    } else {
      void apply(key, target);
    }
  };

  const row = (key: "microphone" | "volume") => {
    const field = fields[key];
    const unknown = field?.value == null;
    const disabled = isBusy || working || unknown || (scheduled && key !== "volume");
    const pending = !unknown && field.draft !== field.value;
    return { field, unknown, disabled, pending };
  };
  const mic = row("microphone"), volume = row("volume");
  const uac = fields.uac, uacDisabled = isBusy || working || scheduled || uac?.value == null;
  const mutedState = (unknown: boolean, pending: boolean) => unknown ? "Not loaded" : pending ? "Applying…" : null;

  return <>
    <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
      <span>{simulated ? "Simulated JA11 · mock values, no USB commands" : "Changes apply immediately"}</span>
      <Button type="button" variant="ghost" size="icon" title="Refresh settings" aria-label="Refresh settings"
        aria-busy={working} disabled={isBusy || working || scheduled} onClick={() => void refresh()}>
        <Icon name="refresh" />
      </Button>
    </div>
    <div className="stack-card">
      <div className="stack-pref-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="ja11-microphone">Inline microphone</label>
          {mic.field?.error
            ? <span role="alert" className="stack-pref-desc text-destructive-foreground">{mic.field.error}</span>
            : <span className="stack-pref-desc">May briefly disconnect</span>}
        </div>
        <div className="stack-pref-control flex items-center gap-3">
          <span role="status" className="text-xs text-muted-foreground">{mutedState(mic.unknown, mic.pending)}</span>
          <Switch id="ja11-microphone" label="Inline microphone" checked={mic.field?.draft === 1}
            disabled={mic.disabled} onCheckedChange={on => change("microphone", on ? 1 : 0)} />
        </div>
      </div>
      <SegmentedRow title="USB audio mode"
        desc={uac?.error ?? (uac?.value != null && uac.draft !== uac.value ? "Applying…" : uac?.value == null ? "Not loaded" : "May briefly disconnect")}
        value={uac?.draft == null ? "" : String(uac.draft)} disabled={uacDisabled}
        options={[{ value: "0", label: "UAC 1.0" }, { value: "1", label: "UAC 2.0" }]}
        onChange={value => change("uac", Number(value))} />
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="ja11-volume">Output volume</label>
          {volume.field?.error
            ? <span role="alert" className="stack-pref-desc text-destructive-foreground">{volume.field.error}</span>
            : <span className="stack-pref-desc">{mutedState(volume.unknown, volume.pending) ?? "Device output level"}</span>}
        </div>
        <div className="stack-pref-control flex items-center gap-3" style={{ minWidth: "min(220px, 40vw)" }}>
          <Slider id="ja11-volume" min={0} max={60} step={1} aria-label="Output volume"
            value={volume.field?.draft ?? 0} disabled={volume.disabled}
            aria-valuetext={volume.field?.draft == null ? "Not loaded" : `${volume.field.draft} out of 60`}
            onChange={event => change("volume", Number(event.target.value))} />
          <output htmlFor="ja11-volume" className="w-14 text-right text-xs tabular-nums text-muted-foreground">
            {volume.field?.draft == null ? "Not loaded" : `${volume.field.draft} / 60`}</output>
        </div>
      </div>
    </div>
    <p className="px-1 text-xs text-muted-foreground">These controls do not save PEQ. Persistence after unplugging has not been verified.</p>
  </>;
}
