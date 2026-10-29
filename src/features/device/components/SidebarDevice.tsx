import { useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, type MouseEvent } from "react";
import { Link } from "react-router";
import type { DeviceInfo } from "@/types";

export interface SidebarDeviceProps {
  connected: boolean;
  /** Waiting for an unplugged DAC to come back. */
  reconnecting?: boolean;
  reconnectingName?: string;
  isSimulated?: boolean;
  deviceInfo?: DeviceInfo;
  to: string;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** Connection status at the foot of the sidebar; details live on the Device page. */
export const SidebarDevice = memo(function SidebarDevice({
  connected,
  reconnecting = false,
  reconnectingName = "",
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
    : reconnecting && reconnectingName
      ? reconnectingName
      : t("sidebarDevice.noDacConnected");
  const [dot, status] = reconnecting
    ? ["reconnecting", t("deviceOperations.reconnecting")]
    : !connected
      ? ["offline", t("sidebarDevice.offline")]
      : isSimulated
        ? ["simulated", t("sidebarDevice.simulation")]
        : ["connected", t("sidebarDevice.connected")];

  return (
    <Link
      to={to}
      className="sidebar-device leg:grid leg:gap-[4px] leg:text-[color:inherit] leg:no-underline leg:rounded-[var(--control-radius)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px] leg:roomy:[.desktop-sidebar_&]:mt-[auto] leg:roomy:[.desktop-sidebar_&]:p-[var(--space-3)_var(--space-2)] leg:roomy:[.desktop-sidebar_&]:[border-top:1px_solid_var(--line-soft)] leg:roomy:[.desktop-sidebar_&]:rounded-[0]"
      onClick={onOpen}
      aria-label={t("sidebarDevice.device", { name: name, status: status })}
    >
      <span className="leg:inline-flex leg:items-center leg:gap-[8px] leg:text-[length:var(--type-caption)] leg:font-medium leg:text-[color:var(--muted)]">
        <span className={`leg:w-[6px] leg:h-[6px] leg:shrink-0 leg:rounded-[var(--radius-pill)] leg:[&.connected]:[background:var(--green)] leg:[&&.simulated]:[background:var(--yellow)] leg:[&&&.offline]:[background:var(--comment)] leg:[&&&&.reconnecting]:[background:var(--sync-working)] leg:[&.reconnecting]:[animation:sidebar-device-pulse_1.2s_ease-in-out_infinite] ${dot}`} aria-hidden="true" />
        {status}
      </span>
      <span className="leg:[.sidebar-device:hover_&]:underline leg:text-[length:14px] leg:font-semibold leg:text-[color:var(--text)] leg:[overflow-wrap:anywhere] leg:leading-[1.4]">{name}</span>
    </Link>
  );
});
