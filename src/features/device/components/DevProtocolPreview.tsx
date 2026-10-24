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

export function matchesPreviewChoice(
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
        <div className="stack-pref-control setting-select-wrapper">
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
              className="app-select-trigger"
              ref={triggerRef}
            >
              <span className="app-select-value">
                <Combobox.Value />
              </span>
              <span className="app-select-arrow">
                <Icon name="expand_more" />
              </span>
            </Combobox.Trigger>
            <Combobox.Portal container={portalContainer}>
              <Combobox.Positioner
                className="app-select-positioner"
                positionMethod="fixed"
                align="start"
                sideOffset={4}
              >
                <Combobox.Popup className="app-select-menu dev-preview-menu">
                  <Combobox.Input
                    className="dev-preview-search"
                    aria-label={t("catalog.search")}
                    placeholder={t("catalog.searchPlaceholder")}
                  />
                  <Combobox.Empty className="dev-preview-empty">
                    {t("catalog.noResults")}
                  </Combobox.Empty>
                  <Combobox.List className="dev-preview-list">
                    {(choice: PreviewChoice) => (
                      <Combobox.Item
                        key={choice.value}
                        value={choice}
                        className={({ selected }) =>
                          `app-select-option ${selected ? "selected" : ""}`
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
      <p className="configuration-description">
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
