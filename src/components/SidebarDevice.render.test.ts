import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SidebarDevice } from "./SidebarDevice";

const render = (props: Partial<Parameters<typeof SidebarDevice>[0]>) => renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(SidebarDevice, { connected: false, to: "/device", ...props })),
);

describe("SidebarDevice markup", () => {
  it("shows only status and name, linking to the Device page", () => {
    const html = render({ connected: false });
    expect(html).toContain('href="/device"');
    expect(html).toContain("Offline");
    expect(html).toContain("No DAC connected");
    expect(html).not.toContain("<dt>");
  });

  it("names the connected DAC and labels simulation", () => {
    const deviceInfo = { path: "/dev/hidraw1", vendor_id: 0x3302, product_id: 1, profile_name: "FiiO KA11" };
    expect(render({ connected: true, deviceInfo })).toContain("FiiO KA11");
    expect(render({ connected: true, deviceInfo })).toContain("Connected");
    expect(render({ connected: true, isSimulated: true, deviceInfo })).toContain("Simulation");
    // A selected-but-offline simulated DAC is not presented as connected.
    expect(render({ connected: false, isSimulated: true, deviceInfo })).toContain("No DAC connected");
  });
});
