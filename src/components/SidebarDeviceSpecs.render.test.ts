import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarDeviceSpecs } from "./SidebarDeviceSpecs";

describe("SidebarDeviceSpecs markup", () => {
  it("renders minimal offline output without virtual dac or engine jargon when disconnected", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarDeviceSpecs, {
        connected: false,
      }),
    );
    expect(html).toContain("Offline");
    expect(html).toContain("Offline Editor");
    expect(html).toContain("DSP");
    expect(html).toContain("<dt>EQ</dt>");
    expect(html).not.toContain("OFFLINE ENGINE");
    expect(html).not.toContain("Virtual DAC");
    expect(html).not.toContain("CHIP");
  });

  it("renders hardware info when connected", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarDeviceSpecs, {
        connected: true,
        deviceInfo: {
          path: "/dev/hidraw1",
          vendor_id: 0x3302,
          product_id: 0x0001,
          profile_name: "FiiO KA11",
        },
      }),
    );
    expect(html).toContain("Connected");
    expect(html).toContain("FiiO KA11");
    expect(html).toContain('class="sidebar-specs-chip"');
    expect(html).toContain("DAC chip:");
    expect(html).toContain("<dt>Output</dt>");
    expect(html).toContain("<dt>Formats</dt>");
    expect(html).toContain("sidebar-specs-row--dsp");
  });

  it("labels simulation and keeps the firmware value intact", () => {
    const html = renderToStaticMarkup(createElement(SidebarDeviceSpecs, {
      connected: true,
      isSimulated: true,
      firmwareVersion: "1.7",
    }));
    expect(html).toContain("Simulation");
    expect(html).toContain("<dt>Firmware</dt><dd>v1.7</dd>");
    expect(html).not.toContain("Connected</span>");
  });
});
