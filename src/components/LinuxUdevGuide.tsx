// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useState } from "react";
import { writeText } from "../lib/rpc";
import { Icon } from "./Icon";

export const UDEV_RULES_URL =
  "https://raw.githubusercontent.com/Bukutsu/glacier-eq/main/udev/69-glacier-eq.rules";

// One paste in a terminal: installs the udev rule and reloads udev.
// The browser cannot escalate privileges (no polkit on web), so this
// manual step replaces the desktop app's one-click installer.
export const UDEV_INSTALL_COMMAND =
  `sudo curl -fsSL ${UDEV_RULES_URL} -o /etc/udev/rules.d/69-glacier-eq.rules && ` +
  `sudo udevadm control --reload-rules && ` +
  `sudo udevadm trigger --subsystem-match=hidraw --action=change`;

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
      setStatus?.("Install command copied — paste it in a terminal.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus?.("Copy failed — select the command manually.");
    }
  };

  return (
    <div className="linux-udev-guide">
      <p>
        Linux blocks browser access to USB DACs by default. The browser can&apos;t
        ask for admin rights, so run this once in a terminal:
      </p>
      <div className="udev-command-row">
        <code>{UDEV_INSTALL_COMMAND}</code>
        <button
          type="button"
          className="btn"
          title={copied ? "Copied!" : "Copy install command"}
          aria-label={copied ? "Copied" : "Copy install command"}
          onClick={copyCommand}
        >
          <Icon>{copied ? "check" : "content_copy"}</Icon>
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {!compact && (
        <p className="card-note">
          Prefer manual steps? Save{" "}
          <a href={UDEV_RULES_URL} target="_blank" rel="noreferrer">69-glacier-eq.rules</a>{" "}
          to <code>/etc/udev/rules.d/</code> as root, then reload udev with the two{" "}
          <code>udevadm</code> commands above.
        </p>
      )}
      <ol className="udev-steps">
        <li>Replug the DAC.</li>
        <li>Hit <strong>Scan for Devices</strong> and approve the browser prompt.</li>
      </ol>
      <p className="card-note">
        Still stuck? Use Chrome or Edge over HTTPS or localhost, close other apps
        holding the DAC, and see the{" "}
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
