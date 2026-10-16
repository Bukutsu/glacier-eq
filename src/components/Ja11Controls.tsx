// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { invokeForDevice } from "../lib/rpc";
import { confirmDialog } from "./ConfirmDialog";
import { Button } from "./ui/Button";
import { Select } from "./Select";
import type { StatusReporter } from "../stores/toastStore";

export const JA11_CONTROLS = [
  { key: "microphone", title: "Inline microphone", max: 1, options: [{ value: "0", label: "Off" }, { value: "1", label: "On" }] },
  { key: "uac", title: "USB audio mode", max: 1, options: [{ value: "0", label: "UAC 1.0" }, { value: "1", label: "UAC 2.0" }] },
  { key: "volume", title: "Output volume", max: 60, options: null },
] as const;

type Field = { value: number | null; draft: number | null; error: string | null };
export function Ja11Controls({ path, isBusy, setStatus }: {
  path: string; isBusy: boolean; setStatus: StatusReporter;
}) {
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [working, setWorking] = useState(false);
  const [restart, setRestart] = useState(false);
  const generation = useRef(0);
  const blocked = useRef(isBusy);
  blocked.current = isBusy;
  const running = useRef(false);
  const needsReconnect = useRef(false);

  const refresh = async (token = generation.current) => {
    if (running.current || blocked.current || needsReconnect.current) return;
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
    needsReconnect.current = false;
    running.current = false;
    setRestart(false);
    void refresh(token);
    return () => { ++generation.current; };
  }, [path]);

  const apply = async (key: string) => {
    const field = fields[key];
    if (blocked.current || running.current || needsReconnect.current || field?.value == null ||
        field.draft == null || field.draft === field.value) return;
    const token = generation.current;
    const target = field.draft;
    running.current = true;
    setWorking(true);
    try {
      const confirmed = await confirmDialog({
        title: key === "volume" ? "Change output volume?" : "Change JA11 setting?",
        message: key === "volume"
          ? `Set output volume to ${target}/60? Lower your system volume before increasing it.`
          : "This change may restart and disconnect the JA11. Reconnect it to verify the setting.",
        confirmLabel: "Apply",
      });
      if (!confirmed || token !== generation.current || blocked.current) return;
      const actual = await invokeForDevice<number | null>(path, "ja11_control", { path, control: key, value: target });
      if (token !== generation.current) return;
      if (actual === null) {
        needsReconnect.current = true;
        setRestart(true);
        setFields({});
        setStatus("JA11 setting sent. Reconnect the DAC to verify it.");
      } else {
        setFields(old => ({ ...old, [key]: { value: actual, draft: actual, error: null } }));
      }
    } catch (error) {
      if (token === generation.current) {
        // A transport error can happen after delivery. Never claim rollback.
        const unknown = { value: null, draft: null, error: String(error) };
        if (key !== "volume") {
          // Delivery can fail after the DAC accepted a restart-causing write.
          needsReconnect.current = true;
          setRestart(true);
          setFields({ [key]: unknown });
        } else {
          setFields(old => ({ ...old, [key]: unknown }));
        }
        setStatus(`Could not verify JA11 setting: ${error}${key === "volume" ? "" : ". Reconnect the DAC before making more changes."}`);
      }
    } finally {
      if (token === generation.current) { running.current = false; setWorking(false); }
    }
  };

  return <>
    <div className="stack-card">
      {JA11_CONTROLS.map(control => {
        const field = fields[control.key];
        const disabled = isBusy || working || restart || field?.value == null;
        return <div className="stack-pref-row select-row" key={control.key}>
          <div className="stack-pref-info">
            <label className="stack-pref-title" htmlFor={`ja11-${control.key}`}>{control.title}</label>
            <span className="stack-pref-desc">{control.key === "volume"
              ? "Device output level, 0–60. Apply explicitly; lower system volume first."
              : "May restart the DAC. Reconnect after applying."}</span>
            {field?.error && <span role="alert">{field.error}</span>}
          </div>
          <div className="stack-pref-control setting-select-wrapper">
            {control.options ? <Select id={`ja11-${control.key}`}
              value={field?.draft == null ? "" : String(field.draft)} disabled={disabled}
              options={[{ value: "", label: "Not loaded", disabled: true }, ...control.options]} onChange={value => setFields(old => ({
                ...old, [control.key]: { ...old[control.key], draft: Number(value) },
              }))} />
              : <input id="ja11-volume" type="number" min={0} max={60} step={1}
                aria-label="Output volume" value={field?.draft ?? ""} disabled={disabled}
                onChange={event => {
                  const value = event.target.value === "" ? null : Number(event.target.value);
                  setFields(old => ({ ...old, volume: { ...old.volume, draft: value } }));
                }} />}
            <Button type="button" disabled={disabled || field?.draft == null ||
              !Number.isInteger(field.draft) || field.draft < 0 || field.draft > control.max ||
              field.draft === field.value} onClick={() => void apply(control.key)}>Apply</Button>
          </div>
        </div>;
      })}
    </div>
    {restart && <p role="status">Setting sent, not yet verified. Reconnect the JA11 before making more changes.</p>}
    <p className="stack-pref-desc">Source-reviewed, not hardware-verified. These controls do not save PEQ. Persistence after unplugging has not been verified.</p>
    <Button type="button" disabled={isBusy || working || restart} onClick={() => void refresh()}>
      {working ? "Reading or updating settings…" : "Refresh settings"}
    </Button>
  </>;
}
