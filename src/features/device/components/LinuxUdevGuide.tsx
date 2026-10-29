import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Trans, useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useState } from "react";
import { invoke, save, writeText } from "@/lib/rpc";
import { Icon } from "@/components/ui/Icon";
import rulesText from "../../../../udev/69-glacier-eq.rules?raw";

const UDEV_RULES_FILENAME = "69-glacier-eq.rules";

const UDEV_INSTALL_COMMAND =
  "sudo install -m644 69-glacier-eq.rules /etc/udev/rules.d/ &&\n" +
  "sudo udevadm control --reload-rules";

// Reuse the normal file-save flow on desktop and web. No asset URL, download
// script, or terminal network access is needed; these are this build's bytes.
async function saveUdevRules(): Promise<void> {
  const path = await save({ defaultPath: UDEV_RULES_FILENAME });
  if (path) await invoke("save_text_file", { path, content: rulesText });
}

export function LinuxUdevGuide({
  setStatus,
}: {
  setStatus?: (message: string) => void;
}) {
  const { t } = useTranslation("device");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveRules = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await saveUdevRules();
    } catch {
      setSaveError(true);
      setStatus?.(t("linuxUdevGuide.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const copyCommand = async () => {
    try {
      await writeText(UDEV_INSTALL_COMMAND);
      setCopied(true);
      setStatus?.(t("linuxUdevGuide.copyComplete"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus?.(t("linuxUdevGuide.copyFailed"));
    }
  };
  return (
    <div className="linux-udev-guide leg:grid leg:gap-[10px] leg:m-[10px_0] leg:text-[length:var(--type-small)] leg:leading-[1.6]">
      <p>
        {t("linuxUdevGuide.introduction", { filename: UDEV_RULES_FILENAME })}
      </p>
      <button
        type="button"
        className="leg:[&:disabled]:cursor-not-allowed leg:[&:disabled]:[background:var(--surface-disabled)]! leg:[&:disabled]:text-[color:var(--text-disabled)]! leg:[&:disabled]:opacity-[1]! leg:inline-flex leg:items-center leg:justify-center leg:gap-[8px] leg:[background:var(--surface-soft)] leg:text-[color:var(--text)] leg:font-medium leg:min-h-[42px] leg:p-[0_18px] leg:rounded-[var(--radius-control)] leg:[outline:1px_solid_var(--line-medium)] leg:[outline-offset:-1px] leg:[transition:filter_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_color_var(--motion-duration)_var(--motion-ease),_outline-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[filter:brightness(1.14)] leg:[&&:active:not(:disabled)]:[filter:brightness(1.24)] leg:[&.filled]:[background:var(--primary)] leg:[&.filled]:text-[color:var(--primary-foreground)] leg:[&&.warning]:[background:var(--yellow)] leg:[&&.warning]:text-[color:var(--on-accent)] leg:pointer-coarse:min-h-[44px] leg:[.confirm-actions_&]:min-h-[44px] leg:[.bands-actions_&&]:min-h-[36px] leg:[.device-summary_.device-hero-actions_&]:w-[auto] leg:[.device-summary_.device-hero-actions_&&]:min-h-[44px] leg:[.device-summary_.device-hero-actions_&]:flex-[0_1_auto] leg:[.empty-state_&]:mt-[8px] leg:[.empty-state_&&&]:min-h-[44px] leg:[.empty-state_&]:p-[0_20px] leg:[.empty-state_&]:rounded-[0]! leg:[.add-trace-download-prompt_&]:[align-self:flex-start] leg:[.add-trace-download-prompt_&&&&]:min-h-[44px] leg:[.device-actions_&]:w-[100%] leg:[.device-actions_&&&&&]:min-h-[52px] leg:[.device-actions_&]:font-bold leg:max-[960px]:[.toolbar_&]:min-w-[0] leg:max-[960px]:[.toolbar_&&]:p-[0_10px] leg:compact:[.bands-actions_&&]:w-[100%] leg:compact:[.bands-actions_&&&&&&]:min-h-[44px] leg:compact:[.bands-actions_&]:justify-center leg:compact:[.bands-actions_&&&]:[background:var(--bg-dark)] leg:compact:[.bands-actions_&]:[outline:1px_solid_var(--line-medium)] leg:compact:[.bands-actions_&]:[outline-offset:-1px] leg:compact:[.mobile-workspace_.device-hero-actions_&&]:w-[auto] leg:compact:[.mobile-workspace_.device-hero-actions_&&&&&&]:min-h-[48px] leg:compact:[.mobile-workspace_.device-hero-actions_&]:rounded-[0]!"
        disabled={saving}
        onClick={saveRules}
      >
        <Icon name="file_download" />
        <span>{t("linuxUdevGuide.saveRules")}</span>
      </button>
      {saveError && <ErrorNotice>{t("linuxUdevGuide.saveFailed")}</ErrorNotice>}
      <div className="udev-command-row leg:grid leg:gap-[8px]">
        <code>{UDEV_INSTALL_COMMAND}</code>
        <button
          type="button"
          className="leg:[&:disabled]:cursor-not-allowed leg:[&:disabled]:[background:var(--surface-disabled)]! leg:[&:disabled]:text-[color:var(--text-disabled)]! leg:[&:disabled]:opacity-[1]! leg:inline-flex leg:items-center leg:justify-center leg:gap-[8px] leg:[background:var(--surface-soft)] leg:text-[color:var(--text)] leg:font-medium leg:min-h-[42px] leg:p-[0_18px] leg:rounded-[var(--radius-control)] leg:[outline:1px_solid_var(--line-medium)] leg:[outline-offset:-1px] leg:[transition:filter_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_color_var(--motion-duration)_var(--motion-ease),_outline-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[filter:brightness(1.14)] leg:[&&:active:not(:disabled)]:[filter:brightness(1.24)] leg:[&.filled]:[background:var(--primary)] leg:[&.filled]:text-[color:var(--primary-foreground)] leg:[&&.warning]:[background:var(--yellow)] leg:[&&.warning]:text-[color:var(--on-accent)] leg:pointer-coarse:min-h-[44px] leg:[.confirm-actions_&]:min-h-[44px] leg:[.bands-actions_&&]:min-h-[36px] leg:[.device-summary_.device-hero-actions_&]:w-[auto] leg:[.device-summary_.device-hero-actions_&&]:min-h-[44px] leg:[.device-summary_.device-hero-actions_&]:flex-[0_1_auto] leg:[.empty-state_&]:mt-[8px] leg:[.empty-state_&&&]:min-h-[44px] leg:[.empty-state_&]:p-[0_20px] leg:[.empty-state_&]:rounded-[0]! leg:[.add-trace-download-prompt_&]:[align-self:flex-start] leg:[.add-trace-download-prompt_&&&&]:min-h-[44px] leg:[.device-actions_&]:w-[100%] leg:[.device-actions_&&&&&]:min-h-[52px] leg:[.device-actions_&]:font-bold leg:max-[960px]:[.toolbar_&]:min-w-[0] leg:max-[960px]:[.toolbar_&&]:p-[0_10px] leg:compact:[.bands-actions_&&]:w-[100%] leg:compact:[.bands-actions_&&&&&&]:min-h-[44px] leg:compact:[.bands-actions_&]:justify-center leg:compact:[.bands-actions_&&&]:[background:var(--bg-dark)] leg:compact:[.bands-actions_&]:[outline:1px_solid_var(--line-medium)] leg:compact:[.bands-actions_&]:[outline-offset:-1px] leg:compact:[.mobile-workspace_.device-hero-actions_&&]:w-[auto] leg:compact:[.mobile-workspace_.device-hero-actions_&&&&&&]:min-h-[48px] leg:compact:[.mobile-workspace_.device-hero-actions_&]:rounded-[0]!"
          title={
            copied
              ? t("linuxUdevGuide.copied")
              : t("linuxUdevGuide.copyInstallCommand")
          }
          aria-label={
            copied
              ? t("linuxUdevGuide.copied")
              : t("linuxUdevGuide.copyInstallCommand")
          }
          onClick={copyCommand}
        >
          <Icon name={copied ? "check" : "content_copy"} />
          <span>
            {copied ? t("linuxUdevGuide.copied") : t("linuxUdevGuide.copy")}
          </span>
        </button>
      </div>
      <ol className="leg:m-[0] leg:pl-[18px] leg:grid leg:gap-[4px]">
        <li>{t("linuxUdevGuide.disconnectAndReconnectTheDac")}</li>
        <li>
          <Trans
            t={t}
            i18nKey="linuxUdevGuide.scanInstruction"
            components={{ scan: <strong /> }}
          />
        </li>
      </ol>
      <p className="leg:m-[0] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.4] leg:[.settings-plain_&]:p-[8px_0_0] leg:[.stack-content>&]:px-[0]! leg:compact:[.mobile-workspace_.stack-content>&]:px-[16px]! cmp:[.configuration-layout_&]:text-[length:var(--type-small)] cmp:[.configuration-layout_&]:leading-[1.5] cmp:[.configuration-layout_&]:text-[color:var(--muted-foreground)]">
        <Trans
          t={t}
          i18nKey="linuxUdevGuide.connectionHelp"
          components={{
            guide: (
              <a
                href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting"
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
        />
      </p>
    </div>
  );
}
