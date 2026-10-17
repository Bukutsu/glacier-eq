// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { invokeForDevice } from "@/lib/rpc";
import {
  createCoalescingTaskScheduler,
  mergeFieldsAtUnchangedRevisions,
  revertFieldIfCurrent,
  setField,
} from "@/lib/serializedWrites";
import type { StatusReporter } from "@/stores/toastStore";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { SegmentedRow } from "@/components/ui/SettingsPrimitives";
import { Icon } from "@/components/ui/Icon";
import { FilterResponse } from "./DacFilterVisual";

export interface DawnProState {
  filter: number;
  high_gain: boolean;
  led: number;
  volume_step: number;
  volume_raw: number;
}

const FILTERS = [
  { value: "0", label: "Fast roll-off, low latency", mode: "FAST-LL" },
  { value: "1", label: "Fast roll-off, phase compensated", mode: "FAST-PC" },
  { value: "2", label: "Slow roll-off, low latency", mode: "Slow-LL" },
  { value: "3", label: "Slow roll-off, phase compensated", mode: "Slow-PC" },
  { value: "4", label: "Non-oversampling", mode: "NON-OS" },
];

// Control values are from Abdul Mateen's hardware-tested original-Dawn code:
// https://github.com/RetR0-hex/moondrop-dawn-pro-gui/blob/69f95f669377646da1e9ba931bec9a5dc9b5d40c/moondrop/protocol.py
export function DawnProControlsFields({
  state,
  disabled,
  onChange,
}: {
  state: DawnProState;
  disabled: boolean;
  onChange: (
    field: "filter" | "high_gain" | "led" | "volume_step",
    value: number | boolean,
  ) => void;
}) {
  return (
    <div className="stack-card">
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="dawn-filter">
            Reconstruction filter
          </label>
          <span className="stack-pref-desc">
            Sets digital filter roll-off and phase response
          </span>
        </div>
        <div className="stack-pref-control setting-select-wrapper">
          <Select
            id="dawn-filter"
            value={String(state.filter)}
            disabled={disabled}
            options={FILTERS}
            onChange={(value) => onChange("filter", Number(value))}
          />
        </div>
      </div>
      <FilterResponse mode={FILTERS[state.filter].mode} />
      <SegmentedRow
        title="Gain"
        desc="High gain gives more power for headphones that need it"
        value={state.high_gain ? "high" : "low"}
        disabled={disabled}
        options={[
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ]}
        onChange={(value) => onChange("high_gain", value === "high")}
      />
      <div className="pref-slider-item pref-slider-first">
        <div className="pref-slider-head">
          <div className="stack-pref-info">
            <label className="stack-pref-title" htmlFor="dawn-volume">
              DAC volume
            </label>
            <span className="stack-pref-desc">
              Hardware volume, separate from Windows volume. Step 60 is full
              output.
            </span>
          </div>
          <span className="pref-value-badge">{state.volume_step}/60</span>
        </div>
        <Slider
          id="dawn-volume"
          min={0}
          max={60}
          step={1}
          disabled={disabled}
          aria-label="DAC volume"
          aria-valuetext={`Step ${state.volume_step} of 60`}
          value={state.volume_step}
          onChange={(event) =>
            onChange("volume_step", Number(event.target.value))
          }
        />
        <p className="stack-pref-desc">
          Last read attenuation code: 0x
          {state.volume_raw.toString(16).padStart(2, "0").toUpperCase()}
        </p>
      </div>
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="dawn-led">
            Indicator LED
          </label>
          <span className="stack-pref-desc">
            Changes the DAC's indicator light
          </span>
        </div>
        <div className="stack-pref-control setting-select-wrapper">
          <Select
            id="dawn-led"
            value={String(state.led)}
            disabled={disabled}
            onChange={(value) => onChange("led", Number(value))}
            options={[
              { value: "0", label: "On" },
              { value: "1", label: "Temporarily off" },
              { value: "2", label: "Off" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

export function DawnProControls({
  path,
  isBusy,
  setStatus,
}: {
  path: string;
  isBusy: boolean;
  setStatus: StatusReporter;
}) {
  const [state, setState] = useState<DawnProState | null>(null);
  const stateRef = useRef<DawnProState | null>(null);
  const confirmed = useRef<DawnProState | null>(null);
  const revisions = useRef<Partial<Record<keyof DawnProState, number>>>({});
  const settledRevisions = useRef<Partial<Record<keyof DawnProState, number>>>(
    {},
  );
  const [scheduler] = useState(() => createCoalescingTaskScheduler<string>());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () =>
    scheduler.enqueue("refresh", async (isCurrent) => {
      if (!isCurrent()) return;
      setRefreshing(true);
      const before = { ...settledRevisions.current };
      try {
        const incoming = await invokeForDevice<DawnProState>(
          path,
          "get_dawn_pro_state",
          { path },
        );
        if (!isCurrent()) return;
        confirmed.current = incoming;
        const next = stateRef.current
          ? mergeFieldsAtUnchangedRevisions(
              stateRef.current,
              incoming,
              before,
              revisions.current,
            )
          : incoming;
        stateRef.current = next;
        setState(next);
        setError(null);
      } catch (error) {
        if (isCurrent()) setError(String(error));
      } finally {
        if (isCurrent()) setRefreshing(false);
      }
    });

  useEffect(() => {
    refresh();
    return () => scheduler.invalidate();
  }, [path]);

  const change = (
    field: "filter" | "high_gain" | "led" | "volume_step",
    value: number | boolean,
  ) => {
    if (isBusy || refreshing || !stateRef.current) return;
    const revision = (revisions.current[field] ?? 0) + 1;
    revisions.current[field] = revision;
    const optimistic = setField(stateRef.current, field, value);
    stateRef.current = optimistic;
    setState(optimistic);
    const control =
      field === "high_gain"
        ? "gain"
        : field === "volume_step"
          ? "volume"
          : field;
    scheduler.enqueue(field, async (isCurrent) => {
      if (!isCurrent()) return;
      // Preserve pending edits, including those queued before this write
      // starts. Only this write's field is being confirmed by its readback.
      const before = { ...settledRevisions.current, [field]: revision };
      try {
        const incoming = await invokeForDevice<DawnProState>(
          path,
          "set_dawn_pro_control",
          { path, control, value: Number(value) },
        );
        if (!isCurrent() || !stateRef.current) return;
        confirmed.current = incoming;
        settledRevisions.current[field] = revision;
        const next = mergeFieldsAtUnchangedRevisions(
          stateRef.current,
          incoming,
          before,
          revisions.current,
        );
        stateRef.current = next;
        setState(next);
        setError(null);
      } catch (error) {
        if (!isCurrent()) return;
        settledRevisions.current[field] = revision;
        if (stateRef.current && confirmed.current) {
          const next = revertFieldIfCurrent(
            stateRef.current,
            confirmed.current,
            field,
            revision,
            revisions.current[field] ?? 0,
          );
          stateRef.current = next;
          setState(next);
        }
        setError(String(error));
        setStatus(`Could not update or verify Dawn Pro setting: ${error}`);
      }
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {refreshing ? "Reading settings…" : "Changes apply immediately"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Refresh settings"
          aria-label="Refresh settings"
          aria-busy={refreshing}
          disabled={isBusy || refreshing}
          onClick={refresh}
        >
          <Icon name="refresh" />
        </Button>
      </div>
      {!state && (
        <section className="settings-card empty-card">
          <div className="empty-state">
            <h3>
              {error
                ? "Could not load Dawn Pro controls"
                : "Reading Dawn Pro settings"}
            </h3>
            <p>
              {error ?? "Reading volume, gain, filter and LED from the DAC…"}
            </p>
          </div>
        </section>
      )}
      {state && (
        <DawnProControlsFields
          state={state}
          disabled={isBusy || refreshing}
          onChange={change}
        />
      )}
      {state && error && <p role="alert">{error}</p>}
    </>
  );
}
