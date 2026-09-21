import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DeviceView } from "./DeviceView";

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
    expect(html).toContain("device-navigation");
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
    expect(html).toContain("Offline Editor");
    expect(html).toContain("Offline specifications");
    expect(html).not.toContain("Sound controls");
    expect(html).not.toContain("Reset &amp; maintenance");
    expect(html).not.toContain("Virtual DAC");
  });

  it("renders all navigation rows when a device is connected", () => {
    const html = renderDeviceView({ connected: true });
    expect(html).toContain("Specifications");
    expect(html).toContain("Sound controls");
    expect(html).toContain("Reset &amp; maintenance");
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
    expect(html).toContain("Controls Unavailable");
    expect(html).not.toContain("device-filter-details");
  });
});
