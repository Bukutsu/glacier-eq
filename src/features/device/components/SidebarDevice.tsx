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
  const name = connected
    ? deviceInfo?.profile_name || deviceInfo?.product_string || "Connected DAC"
    : "No DAC connected";
  const [dot, status] = !connected
    ? ["offline", "Offline"]
    : isSimulated
      ? ["simulated", "Simulation"]
      : ["connected", "Connected"];

  return (
    <Link
      to={to}
      className="sidebar-device"
      onClick={onOpen}
      aria-label={`Device: ${name}, ${status}`}
    >
      <span className="sidebar-device-status">
        <span className={`sidebar-device-dot ${dot}`} aria-hidden="true" />
        {status}
      </span>
      <span className="sidebar-device-name">{name}</span>
    </Link>
  );
});
