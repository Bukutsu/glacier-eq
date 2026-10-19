import { useTranslation } from "react-i18next";
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
  {
    value: "0",
    label: "dawnProControls.fastRollOffLowLatency",
    mode: "FAST-LL",
  },
  {
    value: "1",
    label: "dawnProControls.fastRollOffPhaseCompensated",
    mode: "FAST-PC",
  },
  {
    value: "2",
    label: "dawnProControls.slowRollOffLowLatency",
    mode: "Slow-LL",
  },
  {
    value: "3",
    label: "dawnProControls.slowRollOffPhaseCompensated",
    mode: "Slow-PC",
  },
  { value: "4", label: "dawnProControls.nonOversampling", mode: "NON-OS" },
] as const;

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
  const { t } = useTranslation("device");

  return (
    <div className="stack-card">
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="dawn-filter">
            {t("dawnProControls.reconstructionFilter")}
          </label>
          <span className="stack-pref-desc">
            {t("dawnProControls.filterDescription")}
          </span>
        </div>
        <div className="stack-pref-control setting-select-wrapper">
          <Select
            id="dawn-filter"
            value={String(state.filter)}
            disabled={disabled}
            options={FILTERS.map((filter) => ({
              ...filter,
              label: t(filter.label),
            }))}
            onChange={(value) => onChange("filter", Number(value))}
          />
        </div>
      </div>
      <FilterResponse mode={FILTERS[state.filter].mode} />
      <SegmentedRow
        title={t("dawnProControls.gain")}
        desc={t("dawnProControls.gainDescription")}
        value={state.high_gain ? "high" : "low"}
        disabled={disabled}
        options={[
          { value: "low", label: t("dawnProControls.low") },
          { value: "high", label: t("dawnProControls.high") },
        ]}
        onChange={(value) => onChange("high_gain", value === "high")}
      />
      <div className="pref-slider-item pref-slider-first">
        <div className="pref-slider-head">
          <div className="stack-pref-info">
            <label className="stack-pref-title" htmlFor="dawn-volume">
              {t("dawnProControls.dacVolume")}
            </label>
            <span className="stack-pref-desc">
              {t("dawnProControls.volumeDescription")}
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
          aria-label={t("dawnProControls.dacVolume")}
          aria-valuetext={t("dawnProControls.volumeStep", {
            volume_step: state.volume_step,
          })}
          value={state.volume_step}
          onChange={(event) =>
            onChange("volume_step", Number(event.target.value))
          }
        />
        <p className="stack-pref-desc">
          {t("dawnProControls.attenuationCode", {
            code: state.volume_raw.toString(16).padStart(2, "0").toUpperCase(),
          })}
        </p>
      </div>
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="dawn-led">
            {t("dawnProControls.indicatorLed")}
          </label>
          <span className="stack-pref-desc">
            {t("dawnProControls.ledDescription")}
          </span>
        </div>
        <div className="stack-pref-control setting-select-wrapper">
          <Select
            id="dawn-led"
            value={String(state.led)}
            disabled={disabled}
            onChange={(value) => onChange("led", Number(value))}
            options={[
              { value: "0", label: t("dawnProControls.on") },
              { value: "1", label: t("dawnProControls.temporarilyOff") },
              { value: "2", label: t("dawnProControls.off") },
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
  const { t } = useTranslation("device");

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
        setStatus(
          t("dawnProControls.updateFailed", {
            error: error,
          }),
        );
      }
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {refreshing
            ? t("dawnProControls.readingSettings")
            : t("dawnProControls.changesApplyImmediately")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t("dawnProControls.refreshSettings")}
          aria-label={t("dawnProControls.refreshSettings")}
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
                ? t("dawnProControls.couldNotLoadDawnProControls")
                : t("dawnProControls.readingDawnProSettings")}
            </h3>
            <p>{error ?? t("dawnProControls.loadingDescription")}</p>
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
