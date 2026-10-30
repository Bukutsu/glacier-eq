import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { openExternalLink } from "@/lib/externalLinks";
import { groupDeviceProfiles } from "../lib/deviceCatalog";
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
  /** The session's device. Only a connect changes it, never a row click. */
  selectedDevice: string;
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
  // Highlighting a row must not retarget the live session: device writes,
  // limits and unplug detection all follow selectedDevice.
  const [choice, setChoice] = useState<string | null>(null);
  const chosen =
    choice !== null && devices.some((device) => device.path === choice)
      ? choice
      : selectedDevice;
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then((profiles) =>
        setSupportedDacs(
          groupDeviceProfiles(profiles).map((model) => model.profile),
        ),
      )
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
    <section className="device-card leg:w-[100%] leg:min-h-[0] leg:flex-[1] leg:flex leg:flex-col leg:[background:var(--panel)]">
      <div className="leg:min-h-[0] leg:flex-[1] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:p-[var(--space-4)] leg:flex leg:flex-col leg:gap-[var(--space-4)] cmp:[.device-modal_&]:p-[var(--space-3)_var(--space-5)_var(--space-5)] cmp:compact:[.device-modal_&&]:p-[var(--space-3)_var(--space-4)_var(--space-4)]">
        <div className="device-intro leg:flex leg:items-start leg:gap-[var(--space-3)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-body)] leg:leading-[1.5] cmp:[.device-modal_&]:[background:transparent] cmp:[.device-modal_&]:[border:0] cmp:[.device-modal_&]:p-[0] cmp:[.device-modal_&]:gap-[var(--space-3)]">
          <Icon name="usb" size={22} />
          <p>{t("deviceChooser.introduction")}</p>
        </div>

        {!isTauri() && !("hid" in navigator) && (
          <div className="leg:p-[var(--space-3)] leg:[border-left:3px_solid_var(--yellow)] leg:[background:var(--bg-dark)] leg:text-[color:var(--text)] leg:text-[length:var(--type-small)]">
            {t("deviceChooser.browserRequirement")}
          </div>
        )}

        <Button
          className="leg:w-[100%] leg:min-h-[var(--touch-lg)]"
          onClick={handleScanClick}
          disabled={isBusy}
        >
          <Icon name="search" size={18} />
          {isBusy
            ? t("deviceChooser.scanning")
            : t("deviceChooser.scanForDevices")}
        </Button>

        <h3 className="device-list-heading leg:flex leg:items-center leg:gap-[var(--space-2)] leg:m-[var(--space-2)_0_-8px] leg:text-[color:var(--text)] leg:text-[length:var(--type-body)] leg:font-bold cmp:[.device-modal_&]:text-[length:var(--type-label)] cmp:[.device-modal_&]:font-medium">
          {t("deviceChooser.availableDacs")} <span>{devices.length}</span>
        </h3>
        {devices.length === 0 ? (
          <div className="empty-device-state leg:p-[var(--space-4)] leg:flex leg:flex-col leg:gap-[var(--space-2)] leg:[background:var(--bg-dark)] leg:[border:1px_solid_var(--line-soft)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.5]">
            <strong>{t("deviceChooser.noSupportedDacFound")}</strong>
            <span>{t("deviceChooser.emptyDescription")}</span>
          </div>
        ) : (
          <div
            className="leg:flex leg:flex-col leg:gap-[var(--space-2)]"
            role="radiogroup"
            aria-label={t("deviceChooser.availableDacs")}
          >
            {devices.map((device) => {
              const name =
                device.profile_name ||
                device.product_string ||
                device.manufacturer ||
                t("deviceChooser.supportedDac");
              const selected = chosen === device.path;
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
                  className={selected ? "device-row leg:[.device-card_&]:relative leg:[.device-card_&]:w-[100%] leg:[.device-card_&]:min-h-[88px] leg:[.device-card_&]:flex leg:[.device-card_&]:flex-col leg:[.device-card_&]:items-start leg:[.device-card_&]:justify-center leg:[.device-card_&]:gap-[4px] leg:[.device-card_&]:p-[var(--space-3)_44px_var(--space-3)_var(--space-4)] leg:[.device-card_&]:text-left leg:[.device-card_&]:[background:var(--bg-dark)] leg:[.device-card_&]:text-[color:var(--text)] leg:[.device-card_&]:[border:1px_solid_var(--line-soft)] leg:[.device-card_&]:[touch-action:manipulation] leg:[.device-card_&:hover:not(:disabled)]:[border-color:var(--muted)] leg:[.device-card_&.selected]:[background:var(--accent)] leg:[.device-card_&.selected]:[border-color:var(--ring)] cmp:[.device-modal_&]:rounded-[var(--control-radius)] cmp:[.device-modal_&]:[background:transparent] cmp:[.device-modal_&]:[border-color:var(--border)] cmp:[.device-modal_&.selected]:[background:var(--accent)] cmp:[.device-modal_&.selected]:[border-color:var(--input)] selected" : "device-row leg:[.device-card_&]:relative leg:[.device-card_&]:w-[100%] leg:[.device-card_&]:min-h-[88px] leg:[.device-card_&]:flex leg:[.device-card_&]:flex-col leg:[.device-card_&]:items-start leg:[.device-card_&]:justify-center leg:[.device-card_&]:gap-[4px] leg:[.device-card_&]:p-[var(--space-3)_44px_var(--space-3)_var(--space-4)] leg:[.device-card_&]:text-left leg:[.device-card_&]:[background:var(--bg-dark)] leg:[.device-card_&]:text-[color:var(--text)] leg:[.device-card_&]:[border:1px_solid_var(--line-soft)] leg:[.device-card_&]:[touch-action:manipulation] leg:[.device-card_&:hover:not(:disabled)]:[border-color:var(--muted)] leg:[.device-card_&.selected]:[background:var(--accent)] leg:[.device-card_&.selected]:[border-color:var(--ring)] cmp:[.device-modal_&]:rounded-[var(--control-radius)] cmp:[.device-modal_&]:[background:transparent] cmp:[.device-modal_&]:[border-color:var(--border)] cmp:[.device-modal_&.selected]:[background:var(--accent)] cmp:[.device-modal_&.selected]:[border-color:var(--input)]"}
                  aria-checked={selected}
                  disabled={isBusy}
                  onClick={() => setChoice(device.path)}
                  onDoubleClick={() => {
                    setChoice(device.path);
                    void onConnect(device.path, device);
                  }}
                >
                  <span className="leg:flex leg:items-center leg:flex-wrap leg:gap-[var(--space-2)] leg:max-w-[100%] leg:text-[color:var(--text)] leg:text-[length:var(--type-body)] leg:font-bold">
                    <span className="leg:[overflow-wrap:anywhere] cmp:[.device-modal_&]:text-[length:var(--type-label)] cmp:[.device-modal_&]:font-medium">{name}</span>
                    {isDummy && (
                      <span className="leg:text-[color:var(--on-accent)] leg:[background:var(--orange)] leg:p-[2px_5px] leg:text-[length:var(--type-micro)] leg:font-bold leg:tracking-[0.08em]">
                        {t("deviceChooser.devBadge")}
                      </span>
                    )}
                    {!isDummy && support && (
                      <span
                        className={`leg:text-[color:var(--on-accent)] leg:[background:var(--orange)] leg:p-[2px_5px] leg:text-[length:var(--type-micro)] leg:font-bold leg:tracking-[0.08em] leg:[&.tested]:[background:var(--green)] leg:[&&.untested]:[background:var(--yellow)] ${support.status.toLowerCase()}`}
                      >
                        {supportLabel(support.status)}
                      </span>
                    )}
                  </span>
                  <span className="leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] cmp:[.device-modal_&]:text-[color:var(--muted-foreground)] cmp:[.device-modal_&]:text-[length:var(--type-small)]">
                    {isDummy
                      ? t("deviceChooser.simulatedDeviceForTesting")
                      : device.product_string ||
                        device.manufacturer ||
                        t("deviceChooser.walkplayFamilyDac")}
                  </span>
                  <span className="leg:text-[color:var(--muted)] leg:text-[length:var(--type-caption)] leg:[font-family:var(--font-mono)] cmp:[.device-modal_&]:text-[color:var(--muted-foreground)] cmp:[.device-modal_&]:text-[length:var(--type-small)]">
                    VID {formatUsbId(device.vendor_id)} · PID{" "}
                    {formatUsbId(device.product_id)}
                  </span>
                  <span className="leg:absolute leg:right-[var(--space-4)] leg:top-[50%] leg:[transform:translateY(-50%)] leg:text-[color:var(--muted)] leg:[.device-row.selected_&]:text-[color:var(--link-foreground)] cmp:[.device-modal_&]:text-[color:var(--foreground)]" aria-hidden="true">
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
          className="supported-list leg:[border-top:1px_solid_var(--line-soft)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:mt-[var(--space-2)] cmp:[.modal-content_&]:[border-color:var(--border)] cmp:[.modal-content_&]:rounded-[var(--control-radius)]"
          open={supportedOpen}
          onToggle={(e) => setSupportedOpen(e.currentTarget.open)}
        >
          <summary>
            <span>
              {t("deviceChooser.supportedModels", {
                modelCount: supportedDacs.length,
              })}
            </span>
            <Icon size={18} name="expand_more" className="leg:flex-[0_0_auto] leg:text-[color:var(--muted)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[details[open]>summary_&]:[transform:rotate(180deg)] leg:[.add-trace-cache_summary_&]:ml-[auto]" />
          </summary>
          <p>
            <Link
              to="/supported-devices"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (isTauri()) {
                  event.preventDefault();
                  void openExternalLink(
                    "https://bukutsu.github.io/glacier-eq/#/supported-devices",
                  );
                }
              }}
            >
              {t("catalog.browse")}
            </Link>
          </p>
          <div className="leg:p-[var(--space-2)_0_var(--space-4)] leg:grid leg:gap-[var(--space-3)]">
            {supportedDacs.map((dac) => (
              <div
                className="supported-model leg:flex leg:justify-between leg:flex-wrap leg:gap-[2px_var(--space-3)]"
                key={`${dac.name}:${dac.vendor_id}:${dac.product_id ?? "*"}`}
              >
                <strong>{dac.name}</strong>
                <span>
                  {formatUsbId(dac.vendor_id)}
                  {dac.product_id == null && dac.usb_product_names?.length
                    ? ` · ${t("deviceChooser.usbNameMatch", { name: dac.usb_product_names[0] })}`
                    : `:${dac.product_id == null ? "*" : formatUsbId(dac.product_id)}`}{" "}
                  · {supportLabel(dac.status)}
                </span>
              </div>
            ))}
          </div>
        </details>

        <details className="device-troubleshooting leg:[border-top:1px_solid_var(--line-soft)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] cmp:[.modal-content_&]:[border-color:var(--border)] cmp:[.modal-content_&]:rounded-[var(--control-radius)]">
          <summary>
            {t("deviceChooser.connectionHelp")}
            <Icon size={18} name="expand_more" className="leg:flex-[0_0_auto] leg:text-[color:var(--muted)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[details[open]>summary_&]:[transform:rotate(180deg)] leg:[.add-trace-cache_summary_&]:ml-[auto]" />
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
          {!isTauri() && isLinux() && <LinuxUdevGuide />}
          <a
            href="https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting"
            target="_blank"
            rel="noreferrer"
          >
            {t("deviceChooser.openConnectionHelp")}
          </a>
        </details>
      </div>

      <div className="device-connect-footer leg:compact:[.device-modal_&]:pb-[max(var(--space-3),_var(--safe-area-bottom,_0px))] leg:shrink-0 leg:flex leg:flex-col leg:gap-[var(--space-2)] leg:p-[var(--space-3)_var(--space-4)] leg:[border-top:1px_solid_var(--line-soft)] leg:[background:var(--panel)] cmp:[.device-modal_&]:p-[var(--space-4)_var(--space-5)] cmp:[.device-modal_&]:[background:var(--popover)] cmp:[.device-modal_&]:[border-top:1px_solid_var(--border)] cmp:compact:[.device-modal_&&]:p-[var(--space-4)] cmp:compact:[.device-modal_&&]:pb-[max(var(--space-4),_var(--safe-area-bottom,_0px))]">
        {(authorizationError ||
          (status &&
            status !==
              t("scanDevices.foundDevices", { count: devices.length }))) &&
          (authorizationError ? (
            <ErrorNotice>{authorizationError}</ErrorNotice>
          ) : (
            <span className="leg:[.device-connect-footer_&]:text-[color:var(--muted)] leg:[.device-connect-footer_&]:text-[length:var(--type-small)] leg:[.device-connect-footer_&]:leading-[1.4]" role="status" aria-live="polite">
              {status}
            </span>
          ))}
        <div className="device-actions leg:flex">
          <Button
            variant="primary"
            className="leg:[&:disabled]:cursor-not-allowed leg:[&:disabled]:[background:var(--surface-disabled)]! leg:[&:disabled]:text-[color:var(--text-disabled)]! leg:[&:disabled]:opacity-[1]! leg:inline-flex leg:items-center leg:justify-center leg:gap-[8px] leg:[background:var(--surface-soft)] leg:text-[color:var(--text)] leg:font-medium leg:min-h-[42px] leg:p-[0_18px] leg:rounded-[var(--radius-control)] leg:[outline:1px_solid_var(--line-medium)] leg:[outline-offset:-1px] leg:[transition:filter_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_color_var(--motion-duration)_var(--motion-ease),_outline-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[filter:brightness(1.14)] leg:[&&:active:not(:disabled)]:[filter:brightness(1.24)] leg:[&.filled]:[background:var(--primary)] leg:[&.filled]:text-[color:var(--primary-foreground)] leg:[&&.warning]:[background:var(--yellow)] leg:[&&.warning]:text-[color:var(--on-accent)] leg:pointer-coarse:min-h-[44px] leg:[.confirm-actions_&]:min-h-[44px] leg:[.bands-actions_&&]:min-h-[36px] leg:[.device-summary_.device-hero-actions_&]:w-[auto] leg:[.device-summary_.device-hero-actions_&&]:min-h-[44px] leg:[.device-summary_.device-hero-actions_&]:flex-[0_1_auto] leg:[.empty-state_&]:mt-[8px] leg:[.empty-state_&&&]:min-h-[44px] leg:[.empty-state_&]:p-[0_20px] leg:[.empty-state_&]:rounded-[0]! leg:[.add-trace-download-prompt_&]:[align-self:flex-start] leg:[.add-trace-download-prompt_&&&&]:min-h-[44px] leg:[.device-actions_&]:w-[100%] leg:[.device-actions_&&&&&]:min-h-[52px] leg:[.device-actions_&]:font-bold leg:max-[960px]:[.toolbar_&]:min-w-[0] leg:max-[960px]:[.toolbar_&&]:p-[0_10px] leg:compact:[.bands-actions_&&]:w-[100%] leg:compact:[.bands-actions_&&&&&&]:min-h-[44px] leg:compact:[.bands-actions_&]:justify-center leg:compact:[.bands-actions_&&&]:[background:var(--bg-dark)] leg:compact:[.bands-actions_&]:[outline:1px_solid_var(--line-medium)] leg:compact:[.bands-actions_&]:[outline-offset:-1px] leg:compact:[.mobile-workspace_.device-hero-actions_&&]:w-[auto] leg:compact:[.mobile-workspace_.device-hero-actions_&&&&&&]:min-h-[48px] leg:compact:[.mobile-workspace_.device-hero-actions_&]:rounded-[0]! min-h-[52px]! w-full"
            onClick={() =>
              onConnect(
                chosen,
                devices.find((device) => device.path === chosen),
              )
            }
            disabled={!chosen || isBusy}
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
