import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DeviceView, formatChannelBalance } from "./DeviceView";

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(async () => {
    throw new Error("not connected");
  }),
  listen: vi.fn(async () => () => {}),
}));

function renderDeviceView(props: Partial<Parameters<typeof DeviceView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/device"] },
      createElement(DeviceView, {
        connected: false,
        setStatus: () => {},
        ...props,
      }),
    ),
  );
}

describe("DeviceView markup", () => {
  it("renders a compact summary card and plain navigation on the root section", () => {
    const html = renderDeviceView();
    expect(html).toContain("device-summary");
    // Offline there is only one section, so no navigation column.
    expect(html).not.toContain("device-navigation");
    expect(renderDeviceView({ connected: true })).toContain("device-navigation");
    expect(html).not.toContain("device-hero-card");
    expect(html).not.toContain("Device Configuration");
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
      connected: true, section: "controls",
      deviceInfo: { path: "dawn", vendor_id: 0x2fc6, product_id: 0xf06a, product_name: "Dawn Pro" },
    });
    expect(html).toContain("Reading Dawn Pro settings");
    expect(html).not.toContain("Controls unavailable");
    const other = renderDeviceView({
      connected: true, section: "controls",
      deviceInfo: { path: "other", vendor_id: 0x2fc6, product_id: 0xffff, product_name: "Other Moondrop" },
    });
    expect(other).not.toContain("Reading Dawn Pro settings");
  });

  it("offers no EQ or Walkplay resets for a DAC without them", () => {
    const html = renderDeviceView({
      connected: true, section: "maintenance",
      deviceInfo: { path: "dawn", vendor_id: 0x2fc6, product_id: 0xf06a, hardware_eq: false },
    });
    expect(html).not.toContain("Reset EQ");
    expect(html).not.toContain("Reset controls");
    expect(html).not.toContain("Factory reset");
    expect(html).toContain("This DAC has no maintenance actions.");
  });

  it("exposes protocol selection only for a simulated DAC", () => {
    const deviceInfo = { path: "glacier-dev://dummy-dac", vendor_id: 0x3302, product_id: 0x43e6 };
    const preview = renderDeviceView({ connected: true, isSimulated: true,
      deviceInfo, onPreviewChange: () => {} });
    expect(preview).toContain("Protocol / model preview");
    expect(preview).toContain("No hardware commands are sent");
    const hardware = renderDeviceView({ connected: true, deviceInfo, onPreviewChange: () => {} });
    expect(hardware).not.toContain("Protocol / model preview");
  });

  it("formats channel balance with correct directional labels", () => {
    expect(formatChannelBalance(0)).toBe("Center (0)");
    expect(formatChannelBalance(5)).toBe("Right +5");
    expect(formatChannelBalance(-5)).toBe("Left +5");
  });
});
