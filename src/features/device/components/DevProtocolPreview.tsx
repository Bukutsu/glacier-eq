// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@base-ui/react/combobox";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Icon } from "@/components/ui/Icon";
import { invoke } from "@/lib/rpc";
import {
  buildDevPreviewDevice,
  DEV_DUMMY_DEVICE,
} from "@/features/device/lib/devDevice";
import {
  groupDeviceProfiles,
  filterDeviceModels,
  type CatalogModel,
} from "@/features/device/lib/deviceCatalog";
import type { DeviceInfo, SupportedDeviceInfo } from "@/types";

interface PreviewChoice {
  value: string;
  label: string;
  device: DeviceInfo;
  model: CatalogModel | null;
}

function matchesPreviewChoice(
  choice: PreviewChoice,
  query: string,
): boolean {
  if (choice.model)
    return filterDeviceModels([choice.model], query, "").length > 0;
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => choice.label.toLowerCase().includes(word));
}

export function DevProtocolPreview({
  device,
  disabled,
  onChange,
}: {
  device: DeviceInfo;
  disabled: boolean;
  onChange: (device: DeviceInfo) => void;
}) {
  const { t } = useTranslation("device");
  const [choices, setChoices] = useState<PreviewChoice[]>([]);
  const portalContainer = useRef<HTMLElement | null>(null);
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    portalContainer.current = node
      ? (node.closest("dialog") ?? node.ownerDocument.body)
      : null;
  }, []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then((profiles) => {
        // Use the catalog's grouping: alternate USB IDs are one simulated model.
        const choices = groupDeviceProfiles(profiles).map((model) => {
          const device = buildDevPreviewDevice(model.profile);
          return {
            value: device.path,
            label: model.profile.name,
            device,
            model,
          };
        });
        if (active) setChoices(choices);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  const options: PreviewChoice[] = [
    {
      value: DEV_DUMMY_DEVICE.path,
      label: t("devProtocolPreview.walkplayDefaultDummyDac"),
      device: DEV_DUMMY_DEVICE,
      model: null,
    },
    ...choices,
  ];
  const selected = options.find((choice) => choice.value === device.path) ?? {
    value: device.path,
    label: device.profile_name ?? device.product_string ?? device.path,
    device,
    model: null,
  };
  return (
    <section className="stack-card">
      <div className="stack-pref-row select-row">
        <div className="stack-pref-info">
          <label className="stack-pref-title" htmlFor="dev-preview-model">
            {t("devProtocolPreview.protocolModelPreview")}
          </label>
          <span className="stack-pref-desc">
            {t("devProtocolPreview.description")}
          </span>
        </div>
        <div className="stack-pref-control leg:flex-[0_1_240px] leg:w-[min(240px,_60%)] leg:min-w-[190px] leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:min-w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:flex-[1_1_100%]! cmp:[.configuration-layout_&]:w-[240px] cmp:[.configuration-layout_&]:max-w-[100%] cmp:max-[1050px]:[.configuration-layout_&&]:w-[100%]">
          <Combobox.Root<PreviewChoice>
            items={options}
            value={selected}
            disabled={disabled}
            autoHighlight
            filter={matchesPreviewChoice}
            isItemEqualToValue={(a, b) => a.value === b.value}
            onValueChange={(choice) => {
              if (!disabled && choice && choice.value !== device.path)
                onChange(choice.device);
            }}
          >
            <Combobox.Trigger
              id="dev-preview-model"
              className="app-select-trigger leg:[.mobile-filter-card_&]:h-[32px] leg:flex leg:items-center leg:justify-between leg:w-[100%] leg:h-[36px] leg:[background:var(--input-bg,_var(--surface-soft))] leg:text-[color:var(--text)] leg:p-[0_10px] leg:[border:1px_solid_var(--input-border,_var(--line))] leg:rounded-[var(--radius-control)] leg:[font-family:inherit] leg:text-[length:var(--type-label)] leg:cursor-pointer leg:text-left leg:[outline:none] leg:[transition:border-color_var(--motion-duration)_var(--motion-ease),_background-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] leg:[&:hover:not(:disabled)]:[background:var(--hover-bg)] leg:[&:focus-visible]:[outline:1px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:-1px] leg:[&:disabled]:opacity-[0.5] leg:[&:disabled]:cursor-not-allowed leg:[.add-trace-owner_&]:w-[100%] leg:compact:[.mobile-filter-card_&]:min-h-[44px] cmp:flex cmp:items-center cmp:justify-between cmp:gap-[var(--space-2)] cmp:min-w-[0] cmp:w-[100%] cmp:h-[var(--control-height)] cmp:p-[0_var(--space-3)] cmp:[border:1px_solid_var(--input-border)] cmp:rounded-[var(--control-radius)] cmp:[background:var(--input-bg)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:text-left cmp:cursor-pointer cmp:[&:hover:not(:disabled)]:[border-color:var(--accent-line-hover)] cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:2px] cmp:[&:disabled]:opacity-[0.45] cmp:[&:disabled]:cursor-not-allowed cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&:active:not(:disabled)]:[background:var(--accent)] cmp:compact:[&:active:not(:disabled)]:text-[color:var(--accent-foreground)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:min-h-[44px] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:w-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:h-[auto] cmp:compact:[.mobile-filter-summary_.mobile-band-type_&]:pr-[36px]"
              ref={triggerRef}
            >
              <span className="cmp:min-w-[0] cmp:overflow-hidden cmp:whitespace-nowrap cmp:text-ellipsis">
                <Combobox.Value />
              </span>
              <span className="app-select-arrow leg:absolute leg:top-[50%] leg:right-[10px] leg:[transform:translateY(-50%)] leg:inline-flex leg:items-center leg:justify-center leg:pointer-events-none leg:w-[20px] leg:h-[20px] leg:text-[length:18px] leg:text-[color:var(--muted)] cmp:static cmp:[transform:none] cmp:inline-flex cmp:flex-[0_0_auto] cmp:items-center cmp:justify-center cmp:w-[auto] cmp:h-[auto] cmp:text-[color:var(--muted)]">
                <Icon name="expand_more" />
              </span>
            </Combobox.Trigger>
            <Combobox.Portal container={portalContainer}>
              <Combobox.Positioner
                className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
                positionMethod="fixed"
                align="start"
                sideOffset={4}
              >
                <Combobox.Popup className="cmp:box-border cmp:max-h-[var(--available-height)] cmp:overflow-y-auto cmp:p-[var(--space-1)] cmp:[border:1px_solid_var(--line-medium)] cmp:rounded-[var(--radius-card)] cmp:[background:var(--popover)] cmp:text-[color:var(--popover-foreground)] cmp:[box-shadow:var(--shadow-md)] cmp:[outline:none] cmp:min-w-[var(--anchor-width)] cmp:max-w-[var(--available-width)] cmp:flex cmp:flex-col cmp:w-[max(280px,_var(--anchor-width))] cmp:[&&]:max-h-[min(400px,_var(--available-height))] cmp:overflow-hidden">
                  <Combobox.Input
                    className="cmp:flex-[0_0_auto] cmp:w-[100%] cmp:min-w-[0] cmp:box-border cmp:p-[var(--space-2)_var(--space-3)] cmp:[border:0] cmp:[&&]:[border-bottom:1px_solid_var(--line-medium)] cmp:rounded-[0] cmp:[background:transparent] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:-2px]"
                    aria-label={t("catalog.search")}
                    placeholder={t("catalog.searchPlaceholder")}
                  />
                  <Combobox.Empty className="cmp:[&:not(:empty)]:p-[var(--space-3)] cmp:[&:not(:empty)]:text-[color:var(--muted)] cmp:[&:not(:empty)]:text-[length:var(--type-label)]">
                    {t("catalog.noResults")}
                  </Combobox.Empty>
                  <Combobox.List className="cmp:min-h-[0] cmp:overflow-y-auto cmp:[overscroll-behavior:contain]">
                    {(choice: PreviewChoice) => (
                      <Combobox.Item
                        key={choice.value}
                        value={choice}
                        className={({ selected }) =>
                          `cmp:flex cmp:min-h-[34px] cmp:items-center cmp:gap-[var(--space-2)] cmp:p-[var(--space-2)_var(--space-3)] cmp:rounded-[var(--control-radius)] cmp:text-[color:var(--text)] cmp:[font:400_var(--type-label)/1.4_var(--font-ui)] cmp:cursor-default cmp:[outline:none] cmp:[&[data-highlighted]]:[background:var(--accent)] cmp:[&[data-disabled]]:text-[color:var(--muted)] cmp:[&[data-disabled]]:opacity-[0.5] cmp:[&.selected]:font-semibold cmp:[&&.selected]:[background:var(--accent)] cmp:[.search-select-menu_&&.selected]:[background:transparent] cmp:pointer-coarse:min-h-[var(--touch-md)] cmp:compact:[&&]:min-h-[var(--touch-md)] cmp:compact:[touch-action:manipulation] ${selected ? "selected" : ""}`
                        }
                      >
                        {choice.label}
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
        </div>
      </div>
      <p className="cmp:m-[0_0_var(--space-5)] cmp:text-[color:var(--muted-foreground)] cmp:text-[length:var(--type-small)] cmp:leading-[1.5]">
        {device.hardware_eq
          ? t("devProtocolPreview.previewEq", {
              name: device.profile_name,
              count: device.num_bands,
              rate: device.dsp_sample_rate / 1000,
            })
          : t("devProtocolPreview.previewNoEq", { name: device.profile_name })}
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </section>
  );
}
