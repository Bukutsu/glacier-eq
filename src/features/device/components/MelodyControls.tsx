// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeForDevice } from "@/lib/rpc";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { MELODY_PRESETS } from "@/features/device/lib/melodyPresets";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SelectRow } from "@/components/ui/SettingsPrimitives";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import type { StatusReporter } from "@/stores/toastStore";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";

export function MelodyControls({
  path,
  isBusy,
  setStatus,
  onReadFailure,
  onHardwareEqChanged,
  onBeforePresetChange,
  runMaintenance,
  onResetEq,
  resetSlot,
}: {
  path: string;
  isBusy: boolean;
  setStatus: StatusReporter;
  onReadFailure?: (path: string, error: unknown) => Promise<boolean>;
  onHardwareEqChanged?: () => void;
  onBeforePresetChange?: () => Promise<boolean>;
  runMaintenance?: DeviceMaintenanceRunner;
  onResetEq?: () => Promise<void>;
  resetSlot?: number;
}) {
  const { t } = useTranslation("device");
  const [preset, setPreset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const blocked = useRef(isBusy);
  blocked.current = isBusy;

  const run = async (
    action: (current: () => boolean) => Promise<void>,
    afterSave = false,
  ) => {
    if (running.current || (blocked.current && !afterSave)) return;
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
        setStatus(message, "error");
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

  useEffect(() => {
    ++generation.current;
    running.current = false;
    setPreset(null);
    setError(null);
    setWorking(false);
    return () => {
      ++generation.current;
    };
  }, [path]);

  useEffect(() => {
    if (isBusy && !running.current) setPreset(null);
  }, [isBusy]);

  const disabled = isBusy || working;
  return (
    <>
      <p className="px-1 text-xs text-muted-foreground">
        {isDevDummyDevice(path)
          ? t("melodyControls.simulationDescription")
          : t("melodyControls.changesApplyImmediately")}
      </p>
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
          onChange={async (target) => {
            if (target === -1) return;
            if (onBeforePresetChange && !(await onBeforePresetChange())) return;
            void run(async (current) => {
              onHardwareEqChanged?.();
              setPreset(null);
              const actual = await invokeForDevice<number>(
                path,
                "melody_control",
                { path, value: target },
              );
              if (current()) setPreset(actual);
            }, !!onBeforePresetChange);
          }}
        />
      </div>
      {onResetEq && resetSlot !== undefined && (
        <Button
          type="button"
          disabled={disabled}
          onClick={() => void onResetEq()}
        >
          <Icon name="restart_alt" />
          {t("melodyControls.resetSlot", { slot: resetSlot - 159 })}
        </Button>
      )}
    </>
  );
}
