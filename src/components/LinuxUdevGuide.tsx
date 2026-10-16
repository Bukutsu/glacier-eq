// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useState } from "react";
import { writeText } from "../lib/rpc";
import { Icon } from "./Icon";
import rulesAsset from "../../udev/69-glacier-eq.rules?url&no-inline";
import rulesText from "../../udev/69-glacier-eq.rules?raw";
import { isTauri } from "../lib/platform";

// Vite serves this as a content-addressed asset from the same release as
// the application. Its digest is computed from the same file at build time.
export const UDEV_RULES_SHA256 = __UDEV_RULES_SHA256__;
export const UDEV_RULES_URL = new URL(
  rulesAsset, globalThis.location?.href ?? "http://localhost/",
).href;

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

export function udevInstallCommand(url: string | null): string {
  // A desktop bundle's tauri:// asset URL is not fetchable by terminal curl.
  // Its manual fallback stages the bundled bytes directly, even when offline.
  const stage = url === null
    ? `printf %s ${quote(rulesText)} > "$tmp"; `
    : `curl -fsSL ${quote(url)} -o "$tmp"; `;
  return `set -e; tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT; ` +
    stage +
    `echo "${UDEV_RULES_SHA256}  $tmp" | sha256sum -c -; ` +
    'sudo install -m 0644 "$tmp" /etc/udev/rules.d/69-glacier-eq.rules; ' +
    'sudo udevadm control --reload-rules; ' +
    'sudo udevadm trigger --subsystem-match=hidraw --action=change';
}

export const UDEV_INSTALL_COMMAND = udevInstallCommand(isTauri() ? null : UDEV_RULES_URL);

interface LinuxUdevGuideProps {
  compact?: boolean;
  setStatus?: (message: string) => void;
}

export function LinuxUdevGuide({ compact = false, setStatus }: LinuxUdevGuideProps) {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    try {
      await writeText(UDEV_INSTALL_COMMAND);
      setCopied(true);
      setStatus?.("Install command copied. Paste it into a terminal.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus?.("Copy failed. Select and copy the command manually.");
    }
  };

  return (
    <div className="linux-udev-guide">
      <p>
        Linux restricts browser access to USB DACs by default. The browser cannot
        request administrator access. Run this command once in a terminal:
      </p>
      <div className="udev-command-row">
        <code>{UDEV_INSTALL_COMMAND}</code>
        <button
          type="button"
          className="btn"
          title={copied ? "Copied" : "Copy install command"}
          aria-label={copied ? "Copied" : "Copy install command"}
          onClick={copyCommand}
        >
          <Icon name={copied ? "check" : "content_copy"} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {!compact && (
        <p className="card-note">
          To install manually, save{" "}
          <a href={UDEV_RULES_URL} target="_blank" rel="noreferrer">69-glacier-eq.rules</a>{" "}
          to <code>/etc/udev/rules.d/</code> as root, then reload udev with the two{" "}
          <code>udevadm</code> commands above.
        </p>
      )}
      <ol className="udev-steps">
        <li>Disconnect and reconnect the DAC.</li>
        <li>Select <strong>Scan for devices</strong> and approve the device access prompt.</li>
      </ol>
      <p className="card-note">
        If connection fails, use Chrome or Edge over HTTPS or localhost, close other
        applications using the DAC, and refer to the{" "}
        <a
          href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting"
          target="_blank"
          rel="noreferrer"
        >
          troubleshooting guide
        </a>.
      </p>
    </div>
  );
}
