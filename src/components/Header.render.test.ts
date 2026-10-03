import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "./Header";

const baseHeaderProps: Parameters<typeof Header>[0] = {
  connected: false,
  isBusy: false,
  progress: null,
  profile: "Default",
  deviceName: "",
  profileDirty: false,
  deviceMatchesEditor: null,
  activeBands: 0,
  maxBands: 10,
  preampDb: 0,
  supportsRamApply: false,
  canUndo: false,
  canRedo: false,
  onUndo: () => {},
  onRedo: () => {},
  onPull: () => {},
  onPush: () => {},
  onDisconnect: () => {},
};

describe("Header markup", () => {
  it("keeps one primary mobile save action and puts reads in the device menu", () => {
    const html = renderToStaticMarkup(createElement(Header, {
      ...baseHeaderProps, mobile: true, connected: true, deviceMatchesEditor: false,
    }));
    expect(html).toContain("Changes not saved to DAC");
    expect(html).toContain("Save to DAC");
    expect(html).not.toContain("header-session-strip");
    expect(html).not.toContain("desktop-toolbar");
    expect(html).not.toContain("Write DAC");
    const panel = html.split('class="connection-actions-panel" hidden=""')[1];
    expect(panel).toContain("Read from DAC");
    expect(panel).toContain("Disconnect DAC");
  });

  it("gives offline mobile editing a clear connect action without session stats", () => {
    const html = renderToStaticMarkup(createElement(Header, {
      ...baseHeaderProps, mobile: true,
    }));
    expect(html).toContain("Offline editing");
    expect(html).toContain("Connect DAC");
    expect(html).not.toContain("Profile:");
    expect(html).not.toContain("Save to DAC");
  });

  it("distinguishes an unsaved profile from unwritten DAC changes", () => {
    const html = renderToStaticMarkup(createElement(Header, {
      ...baseHeaderProps, connected: true, profileDirty: true, deviceMatchesEditor: false,
    }));
    expect(html).toContain("Profile: not saved");
    expect(html).toContain("DAC: changes not written");
    expect(html).toContain('class="btn filled" title="Store the editor EQ on the DAC"');
    expect(html).not.toContain('role="menu"');
    expect(html).toContain('aria-label="Device actions" aria-expanded="false"');
  });

  it("marks a saved, edited profile as modified rather than synced", () => {
    const html = renderToStaticMarkup(createElement(Header, {
      ...baseHeaderProps, connected: true, profileSaved: true, profileDirty: true,
      deviceMatchesEditor: true,
    }));
    expect(html).toContain("Profile: modified");
    expect(html).toContain("DAC: matches editor");
  });

  it("renders calm Offline sync dot and omits disconnected error text when not connected", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        connected: false,
      }),
    );
    expect(html).toContain("sync-dot offline");
    expect(html).toContain("Offline");
    expect(html).not.toContain("Device disconnected");
  });

  it("renders connected device name and sync state when connected", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        connected: true,
        deviceName: "FiiO KA11",
        deviceMatchesEditor: true,
      }),
    );
    expect(html).toContain("FiiO KA11");
    expect(html).toContain("DAC: matches editor");
  });
});
