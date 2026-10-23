// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { invokeForDevice } from "@/lib/rpc";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { MELODY_PRESETS } from "@/features/device/lib/melodyPresets";
import { getMelodySlot, setMelodySlot } from "@/features/device/lib/melodySlot";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { SelectRow } from "@/components/ui/SettingsPrimitives";
import type { StatusReporter } from "@/stores/toastStore";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";

export function MelodyControls({
  path,
  isBusy,
  setStatus,
  onReadFailure,
  onHardwareEqChanged,
  runMaintenance,
  onResetEq,
}: {
  path: string;
  isBusy: boolean;
  setStatus: StatusReporter;
  onReadFailure?: (path: string, error: unknown) => Promise<boolean>;
  onHardwareEqChanged?: () => void;
  runMaintenance?: DeviceMaintenanceRunner;
  onResetEq?: () => Promise<void>;
}) {
  const { t } = useTranslation("device");
  const [preset, setPreset] = useState<number | null>(null);
  const [slot, setSlot] = useState(() => getMelodySlot(path));
  const [names, setNames] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const blocked = useRef(isBusy);
  blocked.current = isBusy;

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (running.current || blocked.current) return;
    const token = generation.current;
    running.current = true;
    setWorking(true);
    setError(null);
    const task = async (isCurrent: () => boolean) => {
      const current = () => token === generation.current && isCurrent();
      if (!current()) return;
      try {
        await action(current);
      } catch (failure) {
        if (!current()) return;
        if (await onReadFailure?.(path, failure)) return;
        if (!current()) return;
        const message = t("melodyControls.operationFailed", {
          error: String(failure),
        });
        setError(message);
        setStatus(message);
      }
    };
    try {
      if (runMaintenance) await runMaintenance(task);
      else await task(() => true);
    } finally {
      if (token === generation.current) {
        running.current = false;
        setWorking(false);
      }
    }
  };

  const refresh = () =>
    run(async (current) => {
      // Names are read without selecting slots: no audible background scan.
      const next: Record<number, string> = {};
      for (const id of [160, 161, 162]) {
        if (!current()) return;
        next[id] = await invokeForDevice<string>(path, "melody_name", {
          path,
          slot: id,
        });
      }
      if (current()) {
        setNames(next);
        setDraft(next[slot]);
      }
    });

  useEffect(() => {
    ++generation.current;
    running.current = false;
    const destination = getMelodySlot(path);
    setMelodySlot(path, destination);
    setSlot(destination);
    setPreset(null);
    setNames({});
    setDraft("");
    setError(null);
    setWorking(false);
    setLoaded(false);
    return () => {
      ++generation.current;
    };
  }, [path]);

  useEffect(() => {
    if (!isBusy && !loaded && !running.current) {
      setLoaded(true);
      void refresh();
    }
  }, [isBusy, loaded, path]);

  useEffect(() => {
    // Other EQ operations make the device's preset query stale. Do not
    // display that query (or our previous selection) as confirmed state.
    if (isBusy && !running.current) setPreset(null);
  }, [isBusy]);

  const disabled = isBusy || working;
  const validName = /^[a-z0-9]{1,8}$/i.test(draft);
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {isDevDummyDevice(path)
            ? t("melodyControls.simulationDescription")
            : t("melodyControls.changesApplyImmediately")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t("melodyControls.refreshSettings")}
          aria-label={t("melodyControls.refreshSettings")}
          aria-busy={working}
          disabled={disabled}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" />
        </Button>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="stack-card">
        <SelectRow<number>
          id="melody-preset"
          title={t("melodyControls.eqPreset")}
          desc={t("melodyControls.presetDescription")}
          value={preset ?? -1}
          options={[
            {
              value: -1,
              label: t("melodyControls.unknownPreset"),
              disabled: true,
            },
            ...MELODY_PRESETS.map(({ value, key }) => ({
              value,
              label: t(`melodyControls.presets.${key}`),
            })),
          ]}
          disabled={disabled}
          onChange={(target) => {
            if (target === -1) return;
            void run(async (current) => {
              // Invalidate before sending: delivery may succeed even on error.
              onHardwareEqChanged?.();
              setPreset(null);
              const actual = await invokeForDevice<number>(
                path,
                "melody_control",
                { path, value: target },
              );
              if (current()) setPreset(actual);
            });
          }}
        />
        <SelectRow<number>
          id="melody-destination"
          title={t("melodyControls.destination")}
          desc={t("melodyControls.destinationDescription")}
          value={slot}
          options={[160, 161, 162].map((value) => ({
            value,
            label:
              t(
                value === 160
                  ? "melodyControls.presets.user1"
                  : value === 161
                    ? "melodyControls.presets.user2"
                    : "melodyControls.presets.user3",
              ) + (names[value] ? ` · ${names[value]}` : ""),
          }))}
          disabled={disabled}
          onChange={(value) => {
            setMelodySlot(path, value);
            onHardwareEqChanged?.();
            setSlot(value);
            setDraft(names[value] ?? "");
          }}
        />
        <form
          className="stack-pref-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validName || disabled) return;
            void run(async (current) => {
              // Delivery errors are ambiguous. Hide the old name until a
              // verified write or refresh supplies the stored value again.
              setNames((previous) => {
                const next = { ...previous };
                delete next[slot];
                return next;
              });
              const actual = await invokeForDevice<string>(
                path,
                "melody_name",
                { path, slot, name: draft },
              );
              if (current()) {
                setNames((previous) => ({ ...previous, [slot]: actual }));
                setDraft(actual);
              }
            });
          }}
        >
          <div className="stack-pref-info">
            <label htmlFor="melody-name" className="stack-pref-title">
              {t("melodyControls.slotName")}
            </label>
            <span className="stack-pref-desc">
              {t("melodyControls.nameDescription")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="melody-name"
              value={draft}
              maxLength={8}
              autoComplete="off"
              disabled={disabled || names[slot] === undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              type="submit"
              disabled={
                disabled ||
                !validName ||
                names[slot] === undefined ||
                draft.toUpperCase() === names[slot]
              }
            >
              {t("melodyControls.rename")}
            </Button>
          </div>
        </form>
      </div>
      {onResetEq && (
        <Button
          type="button"
          disabled={disabled}
          onClick={() => void onResetEq()}
        >
          {t("melodyControls.resetSlot", { slot: slot - 159 })}
        </Button>
      )}
    </>
  );
}
