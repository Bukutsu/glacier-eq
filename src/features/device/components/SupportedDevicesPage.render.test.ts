import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  DeviceCatalogResults,
  SupportedDevicesPage,
} from "./SupportedDevicesPage";
import { DEV_DUMMY_DEVICE } from "../lib/devDevice";
import { groupDeviceProfiles } from "../lib/deviceCatalog";
import type { SupportedDeviceInfo } from "@/types";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));
const profile: SupportedDeviceInfo = {
  ...DEV_DUMMY_DEVICE,
  name: "SnowSky test",
  protocol: "FiiO",
  family: "FiiO",
  status: "Untested",
  vendor_id: 0x2972,
  product_id: null,
  usb_product_names: ["SNOWSKY TEST"],
};
describe("public device catalog", () => {
  it("distinguishes EQ support, hardware status, and matching rules", () => {
    const models = groupDeviceProfiles([
      profile,
      {
        ...profile,
        name: "Dawn test",
        protocol: "Moondrop Dawn Pro",
        hardware_eq: false,
        controls: "dawn_pro",
        status: "Tested",
        vendor_id: 0x2fc6,
        product_id: 0xf06a,
      },
    ]);
    const html = renderToStaticMarkup(
      createElement(DeviceCatalogResults, { models, query: "", status: "" }),
    );
    expect(html).toContain("2 of 2 models");
    expect(html).toContain("Untested");
    expect(html).toContain("Tested");
    expect(html).toContain("EQ bands: 10");
    expect(html).toContain("Sound controls only");
    expect(html).toContain("Native app required");
    expect(html).toContain("USB name match");
    expect(html).toContain("2FC6:F06A");
    expect(html).not.toContain("2972:*");
  });
  it("renders a useful empty result", () => {
    const html = renderToStaticMarkup(
      createElement(DeviceCatalogResults, {
        models: groupDeviceProfiles([profile]),
        query: "missing",
        status: "",
      }),
    );
    expect(html).toContain("0 of 1 models");
    expect(html).toContain("No matching devices");
  });
  it("renders a standalone, searchable route without connecting a device", () => {
    vi.stubGlobal("__APP_VERSION__", "test");
    try {
      const html = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: ["/supported-devices?q=melody&status=Untested"] },
          createElement(SupportedDevicesPage),
        ),
      );
      expect(html).toContain('type="search"');
      expect(html).toContain('value="melody"');
      expect(html).toContain('value="Untested" selected=""');
      expect(html).toContain("Loading the device registry");
      expect(html).toContain("Web build test");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
