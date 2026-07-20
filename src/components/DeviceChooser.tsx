import { invoke, requestWebHidDevice } from "../lib/rpc";
import { useEffect, useState } from "react";
import { isDevDummyDevice } from "../lib/devDevice";
import { isTauri } from "../lib/platform";
import type { DeviceInfo, SupportedDeviceInfo } from "../types";


interface DeviceChooserProps {
  devices: DeviceInfo[];
  onScan: () => void | Promise<void>;
  onConnect: () => void | Promise<unknown>;
  selectedDevice: string;
  setSelectedDevice: (path: string) => void;
  status: string;
  isBusy: boolean;
}

function formatUsbId(value: number | null | undefined): string {
  if (value === null || value === undefined) return "****";
  return value.toString(16).padStart(4, "0").toUpperCase();
}

export function DeviceChooser({
  devices,
  onScan,
  onConnect,
  selectedDevice,
  setSelectedDevice,
  status,
  isBusy,
}: DeviceChooserProps) {
  const [supportedDacs, setSupportedDacs] = useState<SupportedDeviceInfo[]>([]);
  const [supportedOpen, setSupportedOpen] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then(setSupportedDacs)
      .catch(() => setSupportedDacs([]));
  }, []);

  const handleScanClick = async () => {
    setAuthorizationError(null);
    try {
      if (!isTauri()) await requestWebHidDevice();
      await onScan();
    } catch (err) {
      setAuthorizationError(
        (err as { name?: string })?.name === "AbortError"
          ? "Device authorization was cancelled."
          : `Device authorization failed: ${err}. Check browser permissions and try again.`,
      );
    }
  };

  return (
    <section className="device-card">
      <button className="btn tonal" style={{ width: "100%" }} onClick={handleScanClick} disabled={isBusy}>{isBusy ? "Scanning…" : "Scan for Devices"}</button>

      {devices.length === 0 ? (
        <div className="empty-device-state">
          <strong>No supported DAC found</strong>
          <span>Plug in one of the supported devices below, then scan again.</span>
        </div>
      ) : (
        <div className="device-list">
          {devices.map((device) => {
            const name = device.profile_name || device.product_string || device.manufacturer || "Supported DAC";
            const selected = selectedDevice === device.path;
            const isDummy = isDevDummyDevice(device.path);
            return (
              <button
                key={device.path}
                className={selected ? "device-row selected" : "device-row"}
                onClick={() => setSelectedDevice(device.path)}
                onDoubleClick={onConnect}
              >
                <span className="device-row-title">
                  {name}
                  {isDummy && <span className="dev-device-badge">DEV</span>}
                </span>
                <span className="device-row-meta">
                  VID: {formatUsbId(device.vendor_id)} &nbsp; PID: {formatUsbId(device.product_id)}
                </span>
                <small>
                  {isDummy
                    ? "No hardware required for UI review"
                    : device.product_string || device.manufacturer || "Walkplay Family DAC"}
                </small>
              </button>
            );
          })}
        </div>
      )}

      <details
        className="supported-list"
        open={supportedOpen}
        onToggle={(e) => setSupportedOpen((e.target as HTMLDetailsElement).open)}
        style={{ padding: "8px 12px", background: "var(--bg-dark)", border: "1px solid var(--line-soft)" }}
      >
        <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "var(--comment)", fontSize: "var(--type-caption)", fontWeight: 700, outline: "none", listStyle: "none" }}>
          <span>SUPPORTED MODELS ({supportedDacs.length})</span>
          <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--cyan)" }}>
            {supportedOpen ? "expand_less" : "expand_more"}
          </span>
        </summary>
        <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
          {supportedDacs.map((dac) => (
            <div key={dac.name} style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--text)", fontSize: "var(--type-small)" }}>
              <strong>{dac.name}</strong>
              <small style={{ color: "var(--muted)" }}>
                {formatUsbId(dac.vendor_id)}:{dac.product_id == null ? "*" : formatUsbId(dac.product_id)} · {dac.status}
              </small>
            </div>
          ))}
        </div>
      </details>

      <div className="device-actions">
        <button className="btn filled" onClick={onConnect} disabled={!selectedDevice || isBusy}>Connect</button>
      </div>
      <span className="status-text">{authorizationError ?? status}</span>
    </section>
  );
}
