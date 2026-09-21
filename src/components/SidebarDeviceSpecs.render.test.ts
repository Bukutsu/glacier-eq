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
    expect(html).toContain("OFFLINE");
    expect(html).toContain("Offline Editor");
    expect(html).toContain("DSP");
    expect(html).toContain("PEQ");
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
    expect(html).toContain("DAC HARDWARE");
    expect(html).toContain("FiiO KA11");
    expect(html).toContain("CHIP");
  });
});
