import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { DeviceInfo } from "@/types";
import { makeDeviceInfo } from "@/features/device/lib/deviceFixtures.test-support";
import { DeviceView, formatChannelBalance } from "./DeviceView";
import {
  buildDevPreviewDevice,
  DEV_DUMMY_DEVICE,
} from "@/features/device/lib/devDevice";

const mobileState = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(async () => {
    throw new Error("not connected");
  }),
  listen: vi.fn(async () => () => {}),
}));

function renderDeviceView(
  props: Omit<Partial<Parameters<typeof DeviceView>[0]>, "deviceInfo"> & {
    deviceInfo?: Partial<DeviceInfo>;
  } = {},
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/device"] },
      createElement(DeviceView, {
        connected: false,
        setStatus: () => {},
        ...props,
        deviceInfo: props.deviceInfo
          ? makeDeviceInfo(props.deviceInfo)
          : undefined,
      }),
    ),
  );
}

describe("DeviceView markup", () => {
  it("shows interactive JA11 controls for a virtual model, not an arbitrary simulation", () => {
    const deviceInfo = buildDevPreviewDevice({
      ...DEV_DUMMY_DEVICE,
      name: "JA11 simulation render",
      protocol: "FiiO JA11",
      vendor_id: 0x2972,
      product_id: 0x0102,
      num_bands: 5,
      status: "Tested",
      family: "FiiO",
      controls: "ja11",
    });
    const html = renderDeviceView({
      connected: true,
      isSimulated: true,
      section: "controls",
      deviceInfo,
    });
    expect(html).toContain("Inline microphone");
    expect(html).toContain("USB audio mode");
    expect(html).toContain('type="range"');
    expect(html).toContain("update mock values immediately");
    expect(html).not.toContain("Changes apply directly to the connected DAC");
    const fake = renderDeviceView({
      connected: true,
      isSimulated: true,
      section: "controls",
      deviceInfo: { ...deviceInfo, path: "/physical-ja11" },
    });
    expect(fake).not.toContain('id="ja11-volume"');
  });

  it("renders a compact summary card and plain navigation on the root section", () => {
    const html = renderDeviceView();
    expect(html).toContain("device-summary");
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="badge"');
    expect(html).not.toContain("device-status-badge");
    // Offline there is only one section, so no navigation column.
    expect(html).not.toContain("device-navigation");
    expect(renderDeviceView({ connected: true })).toContain(
      "device-navigation",
    );
    expect(html).not.toContain("device-hero-card");
    expect(html).not.toContain("Device Configuration");
  });

  it("shows connection actions inline on desktop when connected", () => {
    const html = renderDeviceView({
      connected: true,
      onDisconnect: async () => {},
      onOpenConnectModal: () => {},
      onChooseDevice: () => {},
    });
    expect(html).toContain("device-connection-actions");
    expect(html).not.toContain("<details");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Change device");
  });

  it("keeps connection management in a closed disclosure on mobile", () => {
    mobileState.value = true;
    const html = renderDeviceView({
      connected: true,
      onDisconnect: async () => {},
      onOpenConnectModal: () => {},
      onChooseDevice: () => {},
    });
    expect(html).toContain('<details class="device-connection-options">');
    expect(html).toContain("Connection options");
    expect(html).toContain("Change device");
    expect(html).not.toContain('class="device-connection-options" open');
    const offline = renderDeviceView({ onOpenConnectModal: () => {} });
    expect(offline).toContain("Connect DAC");
    expect(offline).not.toContain("device-connection-options");
    mobileState.value = false;
  });

  it("renders specifications as a definition list instead of tiles", () => {
    const html = renderDeviceView({ section: "overview" });
    expect(html).toContain("device-spec-list");
    expect(html).toContain("EQ bands");
    expect(html).not.toContain("spec-tile");
    expect(html).not.toContain("Supported Hardware");
    expect(html).not.toContain("Chip");
    expect(html).not.toContain("Not reported");
  });

  it("selects only offline specifications and hides hardware-only nav rows when not connected", () => {
    const html = renderDeviceView({ connected: false });
    expect(html).toContain("Offline editor");
    expect(html).toContain("Offline specifications");
    expect(html).not.toContain("Sound controls");
    expect(html).not.toContain("Reset &amp; maintenance");
    expect(html).not.toContain("Virtual DAC");
  });

  it("renders all navigation rows when a device is connected", () => {
    const html = renderDeviceView({ connected: true });
    expect(html).toContain("Specifications");
    expect(html).toContain('href="/device/controls"');
    expect(html).toContain('href="/device/maintenance"');
  });

  it("shows the USB manufacturer and product string a device reports", () => {
    const deviceInfo = {
      path: "/hid",
      vendor_id: 0x2972,
      product_id: 0x0102,
      manufacturer: "Acme Audio",
      product_string: "Reported Name",
    };
    const real = renderDeviceView({
      connected: true,
      section: "overview",
      deviceInfo,
    });
    expect(real).toContain("USB manufacturer");
    expect(real).toContain("Acme Audio");
    expect(real).toContain("USB product");
    expect(real).toContain("Reported Name");
    // Previews show the same rows (with their own made-up values) so the layout can be reviewed without a DAC.
    const preview = renderDeviceView({
      connected: true,
      isSimulated: true,
      section: "overview",
      deviceInfo,
    });
    expect(preview).toContain("USB product");
    const unnamed = renderDeviceView({
      connected: true,
      section: "overview",
      deviceInfo: { ...deviceInfo, manufacturer: null, product_string: null },
    });
    expect(unnamed).not.toContain("USB product");
  });

  it("includes chip in specifications when connected", () => {
    const html = renderDeviceView({ connected: true, section: "overview" });
    expect(html).toContain("Chip");
  });

  it("gates the controls behind loaded hardware state", () => {
    const html = renderDeviceView({
      connected: true,
      section: "controls",
    });
    expect(html).toContain("Controls unavailable");
    expect(html).not.toContain("device-filter-details");
  });

  it("routes only the exact original Dawn Pro to its own controls", () => {
    const html = renderDeviceView({
      connected: true,
      section: "controls",
      deviceInfo: {
        path: "dawn",
        vendor_id: 0x2fc6,
        product_id: 0xf06a,
        hardware_eq: false,
        controls: "dawn_pro",
        product_string: "Dawn Pro",
      },
    });
    expect(html).toContain("Reading Dawn Pro settings");
    expect(html).toContain("Sound controls are supported.");
    expect(html).toContain("This model has no hardware EQ");
    expect(html).toContain("EQ Read/Write actions are unavailable.");
    expect(html).not.toContain("Controls unavailable");
    const other = renderDeviceView({
      connected: true,
      section: "controls",
      deviceInfo: {
        path: "other",
        vendor_id: 0x2fc6,
        product_id: 0xffff,
        product_string: "Other Moondrop",
      },
    });
    expect(other).not.toContain("Reading Dawn Pro settings");
  });

  it.each([0x0101, 0x0102])(
    "routes JA11 %s by catalog controls metadata",
    (product_id) => {
      const html = renderDeviceView({
        connected: true,
        section: "controls",
        deviceInfo: {
          path: "ja11",
          vendor_id: 0x2972,
          product_id,
          controls: "ja11",
        },
      });
      expect(html).toContain("Inline microphone");
      expect(html).not.toContain("Source-reviewed, not hardware-verified");
      expect(html).not.toContain("Controls unavailable");
      expect(html).not.toContain("Class AB amplifier");
    },
  );

  it("offers no EQ or Walkplay resets for a DAC without them", () => {
    const html = renderDeviceView({
      connected: true,
      section: "maintenance",
      deviceInfo: {
        path: "dawn",
        vendor_id: 0x2fc6,
        product_id: 0xf06a,
        controls: "dawn_pro",
        hardware_eq: false,
      },
    });
    expect(html).not.toContain("Reset EQ");
    expect(html).not.toContain("Reset controls");
    expect(html).not.toContain("Factory reset");
    expect(html).toContain("This DAC has no maintenance actions.");
  });

  it("exposes protocol selection only for a simulated DAC", () => {
    const deviceInfo = {
      path: "glacier-dev://dummy-dac",
      vendor_id: 0x3302,
      product_id: 0x43e6,
    };
    const preview = renderDeviceView({
      connected: true,
      isSimulated: true,
      deviceInfo,
      onPreviewChange: () => {},
    });
    expect(preview).toContain("Protocol / model preview");
    expect(preview).toContain("No hardware commands are sent");
    const hardware = renderDeviceView({
      connected: true,
      deviceInfo,
      onPreviewChange: () => {},
    });
    expect(hardware).not.toContain("Protocol / model preview");
  });

  it("formats channel balance with correct directional labels", () => {
    expect(formatChannelBalance(0)).toBe("Center (0)");
    expect(formatChannelBalance(5)).toBe("Right +5");
    expect(formatChannelBalance(-5)).toBe("Left +5");
  });
});
