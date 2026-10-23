import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Trans, useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useState } from "react";
import { invoke, save, writeText } from "@/lib/rpc";
import { Icon } from "@/components/ui/Icon";
import rulesText from "../../../../udev/69-glacier-eq.rules?raw";

export const UDEV_RULES_FILENAME = "69-glacier-eq.rules";

export const UDEV_INSTALL_COMMAND =
  "sudo install -m644 69-glacier-eq.rules /etc/udev/rules.d/ &&\n" +
  "sudo udevadm control --reload-rules";

// Reuse the normal file-save flow on desktop and web. No asset URL, download
// script, or terminal network access is needed; these are this build's bytes.
export async function saveUdevRules(): Promise<void> {
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
    <div className="linux-udev-guide">
      <p>
        {t("linuxUdevGuide.introduction", { filename: UDEV_RULES_FILENAME })}
      </p>
      <button
        type="button"
        className="btn"
        disabled={saving}
        onClick={saveRules}
      >
        <Icon name="file_download" />
        <span>{t("linuxUdevGuide.saveRules")}</span>
      </button>
      {saveError && <ErrorNotice>{t("linuxUdevGuide.saveFailed")}</ErrorNotice>}
      <div className="udev-command-row">
        <code>{UDEV_INSTALL_COMMAND}</code>
        <button
          type="button"
          className="btn"
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
      <ol className="udev-steps">
        <li>{t("linuxUdevGuide.disconnectAndReconnectTheDac")}</li>
        <li>
          <Trans
            t={t}
            i18nKey="linuxUdevGuide.scanInstruction"
            components={{ scan: <strong /> }}
          />
        </li>
      </ol>
      <p className="card-note">
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
