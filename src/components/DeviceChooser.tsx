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
      <ol className="device-setup-steps" role="list" aria-label="Connection steps">
        <li role="listitem"><span>1</span>Plug in and power your DAC</li>
        <li role="listitem"><span>2</span>Scan and approve access if asked</li>
        <li role="listitem"><span>3</span>Select the DAC and connect</li>
      </ol>

      {!isTauri() && !("hid" in navigator) && (
        <div className="device-browser-warning">WebHID requires a Chromium-based browser over HTTPS or localhost.</div>
      )}

      <button type="button" className="btn" style={{ width: "100%" }} onClick={handleScanClick} disabled={isBusy}>{isBusy ? "Scanning…" : "Scan for Devices"}</button>

      {devices.length === 0 ? (
        <div className="empty-device-state">
          <strong>No supported DAC found</strong>
          <span>Plug in one of the supported devices below, then scan again.</span>
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
                title="Click to select · Double-click to connect"
                aria-checked={selected}
                disabled={isBusy}
                onClick={() => {
                  if (!connected) setSelectedDevice(device.path);
                }}
                onDoubleClick={() => {
                  if (!connected) setSelectedDevice(device.path);
                  onConnect(device.path, device);
                }}
              >
                <span className="device-row-title">
                  {name}
                  {isDummy && <span className="dev-device-badge">DEV</span>}
                  {!isDummy && support && (
                    <span className={`device-support-badge ${support.status.toLowerCase()}`}>{support.status}</span>
                  )}
                </span>
                <span className="device-row-meta">
                  VID: {formatUsbId(device.vendor_id)} &nbsp; PID: {formatUsbId(device.product_id)}
                </span>
                <small>
                  {isDummy
                    ? "Simulated device for testing without hardware"
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
        <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "var(--comment)", fontSize: "var(--type-caption)", fontWeight: 700, listStyle: "none" }}>
          <span>SUPPORTED MODELS ({supportedDacs.length})</span>
          <Icon size={16} className="text-cyan">
            {supportedOpen ? "expand_less" : "expand_more"}
          </Icon>
        </summary>
        <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
          {supportedDacs.map((dac) => (
            <div key={dac.name} style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--text)", fontSize: "var(--type-small)" }}>
              <strong>{dac.name}</strong>
              <span style={{ color: "var(--text-dim, var(--cyan))", fontFamily: "var(--font-mono)", fontSize: "var(--type-caption)" }}>
                {formatUsbId(dac.vendor_id)}:{dac.product_id == null ? "*" : formatUsbId(dac.product_id)} · <span style={{ color: dac.status === "Tested" ? "var(--green)" : "var(--yellow)" }}>{dac.status}</span>
              </span>
            </div>
          ))}
        </div>
      </details>

      <details className="device-troubleshooting">
        <summary>Trouble connecting?</summary>
        <ul>
          <li>Replug the DAC and close other apps using it.</li>
          {!isTauri() && <li>Use Chromium and approve the browser device prompt.</li>}
          {isTauri()
            ? <li>On Linux, open Settings &gt; Diagnostics to install the udev rule, then replug the DAC.</li>
            : !isLinux()
              ? <li>On Linux, install the udev rules, then replug the DAC.</li>
              : null}
        </ul>
        {!isTauri() && isLinux() && <LinuxUdevGuide compact />}
        <a href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting" target="_blank" rel="noreferrer">Open connection help</a>
      </details>

      <div className="device-actions">
        <button type="button" className="btn filled" onClick={() => onConnect()} disabled={!selectedDevice || isBusy}>Connect</button>
      </div>
      <span className="status-text" role="status" aria-live="polite">{authorizationError ?? status}</span>
    </section>
  );
}
