import { useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, type MouseEvent } from "react";
import { Link } from "react-router";
import type { DeviceInfo } from "@/types";

export interface SidebarDeviceProps {
  connected: boolean;
  isSimulated?: boolean;
  deviceInfo?: DeviceInfo;
  to: string;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** Connection status at the foot of the sidebar; details live on the Device page. */
export const SidebarDevice = memo(function SidebarDevice({
  connected,
  isSimulated = false,
  deviceInfo,
  to,
  onOpen,
}: SidebarDeviceProps) {
  const { t } = useTranslation("device");

  const name = connected
    ? deviceInfo?.profile_name ||
      deviceInfo?.product_string ||
      t("sidebarDevice.connectedDac")
    : t("sidebarDevice.noDacConnected");
  const [dot, status] = !connected
    ? ["offline", t("sidebarDevice.offline")]
    : isSimulated
      ? ["simulated", t("sidebarDevice.simulation")]
      : ["connected", t("sidebarDevice.connected")];

  return (
    <Link
      to={to}
      className="sidebar-device"
      onClick={onOpen}
      aria-label={t("sidebarDevice.device", { name: name, status: status })}
    >
      <span className="sidebar-device-status">
        <span className={`sidebar-device-dot ${dot}`} aria-hidden="true" />
        {status}
      </span>
      <span className="sidebar-device-name">{name}</span>
    </Link>
  );
});
