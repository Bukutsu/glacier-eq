import { useTranslation } from "react-i18next";
import { invoke, requestWebHidDevice } from "@/lib/rpc";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { LinuxUdevGuide } from "./LinuxUdevGuide";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { isLinux, isTauri } from "@/lib/platform";
import type { DeviceInfo, SupportedDeviceInfo } from "@/types";

interface DeviceChooserProps {
  devices: DeviceInfo[];
  onScan: () => Promise<DeviceInfo[]>;
  onConnect: (
    targetPath?: string,
    target?: DeviceInfo,
  ) => void | Promise<unknown>;
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
  const { t } = useTranslation("device");

  const supportLabel = (status: string) =>
    status === "Tested"
      ? t("deviceChooser.tested")
      : status === "Untested"
        ? t("deviceChooser.untested")
        : status;
  const [supportedDacs, setSupportedDacs] = useState<SupportedDeviceInfo[]>([]);
  const [supportedOpen, setSupportedOpen] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then(setSupportedDacs)
      .catch(() => setSupportedDacs([]));
  }, []);

  const handleScanClick = async () => {
    setAuthorizationError(null);
    try {
      if (!isTauri()) await requestWebHidDevice();
      const found = (await onScan()).filter(
        (device) => !isDevDummyDevice(device.path),
      );
      // One DAC and nothing to choose: connect it, saving a second tap.
      if (!connected && found.length === 1)
        await onConnect(found[0].path, found[0]);
    } catch (err) {
      const cancelled = (err as { name?: string })?.name === "AbortError";
      if (cancelled) {
        // Cancelling the chooser does not revoke previously granted devices;
        // refresh the list so authorized hardware remains discoverable.
        try {
          await onScan();
        } catch (scanError) {
          setAuthorizationError(
            t("deviceChooser.authorizationRefreshFailed", {
              scanError: scanError,
            }),
          );
          return;
        }
      }
      setAuthorizationError(
        cancelled
          ? t("deviceChooser.authorizationCancelled")
          : t("deviceChooser.authorizationFailed", { err: err }),
      );
    }
  };

  return (
    <section className="device-card">
      <div className="device-chooser-content">
        <div className="device-intro">
          <Icon name="usb" size={22} />
          <p>{t("deviceChooser.introduction")}</p>
        </div>

        {!isTauri() && !("hid" in navigator) && (
          <div className="device-browser-warning">
            {t("deviceChooser.browserRequirement")}
          </div>
        )}

        <Button
          className="device-scan-btn"
          onClick={handleScanClick}
          disabled={isBusy}
        >
          <Icon name="search" size={18} />
          {isBusy
            ? t("deviceChooser.scanning")
            : t("deviceChooser.scanForDevices")}
        </Button>

        <h3 className="device-list-heading">
          {t("deviceChooser.availableDacs")} <span>{devices.length}</span>
        </h3>
        {devices.length === 0 ? (
          <div className="empty-device-state">
            <strong>{t("deviceChooser.noSupportedDacFound")}</strong>
            <span>{t("deviceChooser.emptyDescription")}</span>
          </div>
        ) : (
          <div
            className="device-list"
            role="radiogroup"
            aria-label={t("deviceChooser.availableDacs")}
          >
            {devices.map((device) => {
              const name =
                device.profile_name ||
                device.product_string ||
                device.manufacturer ||
                t("deviceChooser.supportedDac");
              const selected = selectedDevice === device.path;
              const isDummy = isDevDummyDevice(device.path);
              const support = supportedDacs.find(
                (dac) =>
                  dac.vendor_id === device.vendor_id &&
                  (dac.product_id === null ||
                    dac.product_id === device.product_id),
              );
              return (
                <button
                  key={device.path}
                  type="button"
                  role="radio"
                  data-slot="device-option"
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
                    {isDummy && (
                      <span className="dev-device-badge">
                        {t("deviceChooser.devBadge")}
                      </span>
                    )}
                    {!isDummy && support && (
                      <span
                        className={`device-support-badge ${support.status.toLowerCase()}`}
                      >
                        {supportLabel(support.status)}
                      </span>
                    )}
                  </span>
                  <span className="device-row-description">
                    {isDummy
                      ? t("deviceChooser.simulatedDeviceForTesting")
                      : device.product_string ||
                        device.manufacturer ||
                        t("deviceChooser.walkplayFamilyDac")}
                  </span>
                  <span className="device-row-meta">
                    VID {formatUsbId(device.vendor_id)} · PID{" "}
                    {formatUsbId(device.product_id)}
                  </span>
                  <span className="device-selection-mark" aria-hidden="true">
                    <Icon
                      name={
                        selected
                          ? "radio_button_checked"
                          : "radio_button_unchecked"
                      }
                      size={20}
                    />
                  </span>
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
            <span>
              {t("deviceChooser.supportedModels", {
                modelCount: supportedDacs.length,
              })}
            </span>
            <Icon size={18} name="expand_more" className="disclosure-chevron" />
          </summary>
          <div className="supported-models">
            {supportedDacs.map((dac) => (
              <div
                className="supported-model"
                key={`${dac.name}:${dac.vendor_id}:${dac.product_id ?? "*"}`}
              >
                <strong>{dac.name}</strong>
                <span>
                  {formatUsbId(dac.vendor_id)}:
                  {dac.product_id == null ? "*" : formatUsbId(dac.product_id)} ·{" "}
                  {supportLabel(dac.status)}
                </span>
              </div>
            ))}
          </div>
        </details>

        <details className="device-troubleshooting">
          <summary>
            {t("deviceChooser.connectionHelp")}
            <Icon size={18} name="expand_more" className="disclosure-chevron" />
          </summary>
          <ul>
            <li>{t("deviceChooser.reconnectHelp")}</li>
            {!isTauri() && <li>{t("deviceChooser.browserHelp")}</li>}
            {isTauri() ? (
              <li>{t("deviceChooser.linuxSettingsHelp")}</li>
            ) : !isLinux() ? (
              <li>{t("deviceChooser.linuxHelp")}</li>
            ) : null}
          </ul>
          {!isTauri() && isLinux() && <LinuxUdevGuide compact />}
          <a
            href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting"
            target="_blank"
            rel="noreferrer"
          >
            {t("deviceChooser.openConnectionHelp")}
          </a>
        </details>
      </div>

      <div className="device-connect-footer">
        {(authorizationError ||
          (status &&
            status !==
              t("scanDevices.foundDevices", { count: devices.length }))) && (
          <span className="status-text" role="status" aria-live="polite">
            {authorizationError ?? status}
          </span>
        )}
        <div className="device-actions">
          <Button
            variant="primary"
            className="btn min-h-[52px]! w-full"
            onClick={() => onConnect()}
            disabled={!selectedDevice || isBusy}
          >
            {connected
              ? t("deviceChooser.switchToThisDevice")
              : t("deviceChooser.connectDac")}
          </Button>
        </div>
      </div>
    </section>
  );
}
