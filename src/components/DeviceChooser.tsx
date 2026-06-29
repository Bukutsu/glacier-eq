import { invoke, requestWebHidDevice } from "../lib/rpc";
import { useEffect, useState } from "react";
import { isDevDummyDevice } from "../lib/devDevice";
import { isTauri } from "../lib/platform";
import type { DeviceInfo, SupportedDeviceInfo } from "../types";


interface DeviceChooserProps {
  devices: DeviceInfo[];
  onScan: () => void;
  onConnect: () => void;
  selectedDevice: string;
  setSelectedDevice: (path: string) => void;
  status: string;
  isBusy: boolean;
}

function formatUsbId(value: number): string {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

function formatOptionalUsbId(value: number | null): string {
  return value === null ? "*" : formatUsbId(value);
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

  useEffect(() => {
    invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then(setSupportedDacs)
      .catch(() => setSupportedDacs([]));
  }, []);

  const handleScanClick = async () => {
    if (!isTauri()) {
      await requestWebHidDevice();
    }
    onScan();
  };

  return (
    <main className="disconnected-screen">
      <section className="device-card">
        <div className="device-card-head">
          <div>
            <h2>Available Devices</h2>
            <p>Only supported DACs from the Glacier registry are shown.</p>
          </div>
          <button className="btn tonal" onClick={handleScanClick} disabled={isBusy}>{isBusy ? "Scanning…" : "Scan"}</button>
        </div>

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

        <div className="supported-list">
          <span>SUPPORTED</span>
          {supportedDacs.map((dac) => (
            <div key={dac.name}>
              <strong>{dac.name}</strong>
              <small>
                {formatUsbId(dac.vendor_id)}:{formatOptionalUsbId(dac.product_id)} · {dac.status}
              </small>
            </div>
          ))}
        </div>

        <div className="device-actions">
          <button className="btn filled" onClick={onConnect} disabled={!selectedDevice || isBusy}>Connect</button>
        </div>
        <span className="status-text">{status}</span>
      </section>
    </main>
  );
}
