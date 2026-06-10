import { SUPPORTED_DACS } from "../constants";
import type { DeviceInfo } from "../types";
import { ToolbarButton } from "./ToolbarButton";

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

export function DeviceChooser({
  devices,
  onScan,
  onConnect,
  selectedDevice,
  setSelectedDevice,
  status,
  isBusy,
}: DeviceChooserProps) {
  return (
    <main className="disconnected-screen">
      <section className="device-card">
        <div className="device-card-head">
          <div>
            <h2>Available Devices</h2>
            <p>Only supported DACs from Frost-Tune's registry are shown.</p>
          </div>
          <ToolbarButton onClick={onScan} disabled={isBusy}>{isBusy ? "Scanning…" : "Scan"}</ToolbarButton>
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
              return (
                <button
                  key={device.path}
                  className={selected ? "device-row selected" : "device-row"}
                  onClick={() => setSelectedDevice(device.path)}
                  onDoubleClick={onConnect}
                >
                  <span className="device-row-title">{name}</span>
                  <span className="device-row-meta">
                    VID: {formatUsbId(device.vendor_id)} &nbsp; PID: {formatUsbId(device.product_id)}
                  </span>
                  <small>{device.product_string || device.manufacturer || "Walkplay Family DAC"}</small>
                </button>
              );
            })}
          </div>
        )}

        <div className="supported-list">
          <span>SUPPORTED</span>
          {SUPPORTED_DACS.map((dac) => (
            <div key={dac.name}>
              <strong>{dac.name}</strong>
              <small>{dac.vid}:{dac.pid} · {dac.status}</small>
            </div>
          ))}
        </div>

        <div className="device-actions">
          <ToolbarButton primary onClick={onConnect} disabled={!selectedDevice || isBusy}>Connect</ToolbarButton>
        </div>
        <span className="status-text">{status}</span>
      </section>
    </main>
  );
}
