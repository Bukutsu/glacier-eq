import { invoke, requestWebHidDevice } from "../lib/rpc";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { LinuxUdevGuide } from "./LinuxUdevGuide";
import { isDevDummyDevice } from "../lib/devDevice";
import { isLinux, isTauri } from "../lib/platform";
import type { DeviceInfo, SupportedDeviceInfo } from "../types";


interface DeviceChooserProps {
  devices: DeviceInfo[];
  onScan: () => void | Promise<void>;
  onConnect: (targetPath?: string, target?: DeviceInfo) => void | Promise<unknown>;
  selectedDevice: string;
  setSelectedDevice: (path: string) => void;
  status: string;
  isBusy: boolean;
  connected: boolean;
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
  connected,
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
      const cancelled = (err as { name?: string })?.name === "AbortError";
      if (cancelled) {
        // Cancelling the chooser does not revoke previously granted devices;
        // refresh the list so authorized hardware remains discoverable.
        try {
          await onScan();
        } catch (scanError) {
          setAuthorizationError(`Device authorization cancelled; refresh failed: ${scanError}`);
          return;
        }
      }
      setAuthorizationError(
        cancelled
          ? "Device authorization cancelled. Previously authorized devices were rescanned."
          : `Device authorization failed: ${err}. Check browser permissions and try again.`,
      );
    }
  };

  return (
    <section className="device-card">
      <div className="device-chooser-content">
        <div className="device-intro">
          <Icon name="usb" size={22} />
          <p>Connect and power on the DAC, then scan for devices. Approve access if prompted.</p>
        </div>

        {!isTauri() && !("hid" in navigator) && (
          <div className="device-browser-warning">WebHID requires a Chromium-based browser over HTTPS or localhost.</div>
        )}

        <button type="button" className="btn device-scan-btn" onClick={handleScanClick} disabled={isBusy}>
          <Icon name="search" size={18} />{isBusy ? "Scanning…" : "Scan for devices"}
        </button>

        <h3 className="device-list-heading">Available DACs <span>{devices.length}</span></h3>
        {devices.length === 0 ? (
          <div className="empty-device-state">
            <strong>No supported DAC found</strong>
            <span>Connect a supported device listed below, then scan again.</span>
          </div>
        ) : (
          <div className="device-list" role="radiogroup" aria-label="Available DACs">
            {devices.map((device) => {
              const name = device.profile_name || device.product_string || device.manufacturer || "Supported DAC";
              const selected = selectedDevice === device.path;
              const isDummy = isDevDummyDevice(device.path);
              const support = supportedDacs.find((dac) =>
                dac.vendor_id === device.vendor_id &&
                (dac.product_id === null || dac.product_id === device.product_id)
              );
              return (
                <button
                  key={device.path}
                  type="button"
                  role="radio"
                  className={selected ? "device-row selected" : "device-row"}
                  aria-checked={selected}
                  disabled={isBusy}
                  onClick={() => {
                    setSelectedDevice(device.path);
                  }}
                  onDoubleClick={() => {
                    setSelectedDevice(device.path);
                    onConnect(device.path, device);
                  }}
                >
                  <span className="device-row-title">
                    <span className="device-row-name">{name}</span>
                    {isDummy && <span className="dev-device-badge">DEV</span>}
                    {!isDummy && support && (
                      <span className={`device-support-badge ${support.status.toLowerCase()}`}>{support.status}</span>
                    )}
                  </span>
                  <span className="device-row-description">
                    {isDummy ? "Simulated device for testing" : device.product_string || device.manufacturer || "Walkplay family DAC"}
                  </span>
                  <span className="device-row-meta">VID {formatUsbId(device.vendor_id)} · PID {formatUsbId(device.product_id)}</span>
                  <span className="device-selection-mark" aria-hidden="true"><Icon name={selected ? "radio_button_checked" : "radio_button_unchecked"} size={20} /></span>
                </button>
              );
            })}
          </div>
        )}

        <details
          className="supported-list"
          open={supportedOpen}
          onToggle={(e) => setSupportedOpen(e.currentTarget.open)}
        >
          <summary>
            <span>Supported models ({supportedDacs.length})</span>
            <Icon size={18} name={supportedOpen ? "expand_less" : "expand_more"} />
          </summary>
          <div className="supported-models">
            {supportedDacs.map((dac) => (
              <div className="supported-model" key={dac.name}>
                <strong>{dac.name}</strong>
                <span>{formatUsbId(dac.vendor_id)}:{dac.product_id == null ? "*" : formatUsbId(dac.product_id)} · {dac.status}</span>
              </div>
            ))}
          </div>
        </details>

        <details className="device-troubleshooting">
          <summary>Connection help</summary>
          <ul>
            <li>Disconnect and reconnect the DAC, and close other applications using it.</li>
            {!isTauri() && <li>Use a Chromium-based browser and approve the device access prompt.</li>}
            {isTauri()
              ? <li>On Linux, open Settings &gt; Diagnostics &amp; permissions to install the udev rule, then reconnect the DAC.</li>
              : !isLinux()
                ? <li>On Linux, install the udev rules, then reconnect the DAC.</li>
                : null}
          </ul>
          {!isTauri() && isLinux() && <LinuxUdevGuide compact />}
          <a href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting" target="_blank" rel="noreferrer">Open connection help</a>
        </details>
      </div>

      <div className="device-connect-footer">
        {(authorizationError || (status && !/^Found \d+ devices?$/.test(status))) && (
          <span className="status-text" role="status" aria-live="polite">{authorizationError ?? status}</span>
        )}
        <div className="device-actions">
          <button type="button" className="btn filled" onClick={() => onConnect()} disabled={!selectedDevice || isBusy}>
            {connected ? "Switch to this device" : "Connect DAC"}
          </button>
        </div>
      </div>
    </section>
  );
}
