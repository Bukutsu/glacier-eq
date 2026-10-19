import { Trans, useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useState } from "react";
import { writeText } from "@/lib/rpc";
import { Icon } from "@/components/ui/Icon";
import rulesAsset from "../../../../udev/69-glacier-eq.rules?url&no-inline";
import rulesText from "../../../../udev/69-glacier-eq.rules?raw";
import { isTauri } from "@/lib/platform";

// Vite serves this as a content-addressed asset from the same release as
// the application. Its digest is computed from the same file at build time.
export const UDEV_RULES_SHA256 = __UDEV_RULES_SHA256__;
export const UDEV_RULES_URL = new URL(
  rulesAsset,
  globalThis.location?.href ?? "http://localhost/",
).href;

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/* eslint-disable i18next/no-literal-string -- Shell commands must not be translated. */
export function udevInstallCommand(url: string | null): string {
  // A desktop bundle's tauri:// asset URL is not fetchable by terminal curl.
  // Its manual fallback stages the bundled bytes directly, even when offline.
  const stage =
    url === null
      ? `printf %s ${quote(rulesText)} > "$tmp"; `
      : `curl -fsSL ${quote(url)} -o "$tmp"; `;
  return (
    `set -e; tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT; ` +
    stage +
    `echo "${UDEV_RULES_SHA256}  $tmp" | sha256sum -c -; ` +
    'sudo install -m 0644 "$tmp" /etc/udev/rules.d/69-glacier-eq.rules; ' +
    "sudo udevadm control --reload-rules; " +
    "sudo udevadm trigger --subsystem-match=hidraw --action=change"
  );
}

/* eslint-enable i18next/no-literal-string */

export const UDEV_INSTALL_COMMAND = udevInstallCommand(
  isTauri() ? null : UDEV_RULES_URL,
);

interface LinuxUdevGuideProps {
  compact?: boolean;
  setStatus?: (message: string) => void;
}

export function LinuxUdevGuide({
  compact = false,
  setStatus,
}: LinuxUdevGuideProps) {
  const { t } = useTranslation("device");

  const [copied, setCopied] = useState(false);

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
      <p>{t("linuxUdevGuide.introduction")}</p>
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
      {!compact && (
        <p className="card-note">
          <Trans
            t={t}
            i18nKey="linuxUdevGuide.manualInstall"
            values={{
              filename: "69-glacier-eq.rules",
              directory: "/etc/udev/rules.d/",
              command: "udevadm",
            }}
            components={{
              rules: (
                <a href={UDEV_RULES_URL} target="_blank" rel="noreferrer" />
              ),
              directory: <code />,
              command: <code />,
            }}
          />
        </p>
      )}
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
