import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "./Header";
import { DraftRecovery } from "@/features/eq/components/DraftRecovery";

const baseHeaderProps: Parameters<typeof Header>[0] = {
  connected: false,
  isBusy: false,
  progress: null,
  profile: "Default",
  profileDirty: false,
  deviceMatchesEditor: null,
  hardwareEq: true,
  canUndo: false,
  canRedo: false,
  onUndo: () => {},
  onRedo: () => {},
  onPull: () => {},
  onPush: () => {},
  onExportEq: () => {},
  onDisconnect: () => {},
};

describe("Header markup", () => {
  it.each([false, true])(
    "keeps draft recovery in the header metadata (mobile=%s)",
    (mobile) => {
      const html = renderToStaticMarkup(
        createElement(Header, {
          ...baseHeaderProps,
          mobile,
          draftRecovery: createElement(DraftRecovery, {
            invalid: false,
            connected: false,
            isBusy: false,
            onRestore: () => {},
            onDiscard: () => {},
          }),
        }),
      );
      expect(html).toContain("Unfinished EQ");
      expect(html).toContain(
        'aria-label="EQ editing paused: restore or discard unfinished EQ to continue"',
      );
      expect(html).toContain("<strong>Editing paused</strong>");
      expect(html).toContain('class="header-draft-trigger"');
      expect(html).toContain('aria-expanded="false"');
      expect(html.indexOf("Unfinished EQ")).toBeGreaterThan(
        html.indexOf('class="header-meta-row"'),
      );
      expect(html.indexOf("Unfinished EQ")).toBeLessThan(
        html.indexOf(
          mobile ? 'class="mobile-toolbar"' : 'class="toolbar desktop-toolbar"',
        ),
      );
      expect(html).not.toContain("editor-draft-recovery");
      expect(html).not.toContain("Nothing will be written to a DAC.");
    },
  );

  it("labels unreadable drafts without offering a restore in the closed header", () => {
    const html = renderToStaticMarkup(
      createElement(DraftRecovery, {
        invalid: true,
        connected: false,
        isBusy: false,
        onRestore: () => {},
        onDiscard: () => {},
      }),
    );
    expect(html).toContain("Unreadable draft");
    expect(html).toContain(
      'aria-label="EQ editing paused: discard the unreadable draft to continue"',
    );
    expect(html).toContain("<strong>Editing paused</strong>");
    expect(html).not.toContain("Restore EQ");
  });

  it.each([false, true])(
    "hides EQ read and write for a DAC without hardware EQ (mobile=%s)",
    (mobile) => {
      const html = renderToStaticMarkup(
        createElement(Header, {
          ...baseHeaderProps,
          connected: true,
          hardwareEq: false,
          mobile,
        }),
      );
      expect(html).toContain('class="header-eq-note" role="note"');
      expect(html).toContain("This DAC has no hardware EQ");
      expect(html).toContain("EQ Read/Write actions are");
      expect(html).toContain("edit and export EQ");
      expect(html).not.toContain("Read from DAC");
      expect(html).not.toContain("Write to DAC");
      expect(html).not.toContain("Save to DAC");
    },
  );

  it("does not show the hardware limitation while offline or with an EQ-capable DAC", () => {
    for (const connected of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(Header, { ...baseHeaderProps, connected }),
      );
      expect(html).not.toContain('class="header-eq-note"');
    }
  });

  it.each([false, true])(
    "offers EQ export on the EQ page, offline too (mobile=%s)",
    (mobile) => {
      const html = renderToStaticMarkup(
        createElement(Header, { ...baseHeaderProps, mobile }),
      );
      expect(html).toContain('aria-label="Export EQ file"');
    },
  );

  it("keeps EQ export off desktop settings pages", () => {
    const html = renderToStaticMarkup(
      createElement(Header, { ...baseHeaderProps, configPage: "settings" }),
    );
    expect(html).not.toContain('aria-label="Export EQ file"');
  });

  it("keeps one primary mobile save action and puts reads in the device menu", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        mobile: true,
        connected: true,
        deviceMatchesEditor: false,
      }),
    );
    expect(html).toContain("Changes not saved to DAC");
    expect(html).toContain("Save to DAC");
    expect(html).not.toContain("header-session-strip");
    expect(html).not.toContain("desktop-toolbar");
    expect(html).not.toContain("Write DAC");
    const trigger = html.match(
      /<button[^>]*aria-label="Device actions"[^>]*>/,
    )?.[0];
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="false"');
    // Menu items are portaled only when opened; reads stay out of the toolbar.
    expect(html).not.toContain(">Read from DAC</button>");
  });

  it("gives offline mobile editing a clear connect action without session stats", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        mobile: true,
      }),
    );
    expect(html).toContain("Offline editing");
    expect(html).toContain("Connect DAC");
    expect(html).not.toContain("Profile:");
    expect(html).not.toContain("Save to DAC");
  });

  it("distinguishes an unsaved profile from unwritten DAC changes", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        connected: true,
        profileDirty: true,
        deviceMatchesEditor: false,
      }),
    );
    expect(html).toContain("Profile: not saved");
    expect(html).toContain("DAC: changes not written");
    const write = html.match(
      /<button[^>]*title="Store the editor EQ on the DAC"[^>]*>/,
    )?.[0];
    expect(write).toContain('data-variant="primary"');
    // Disconnect is a plain header button, not a one-item menu.
    expect(html).not.toContain('aria-label="Device actions"');
    expect(html).toContain("Disconnect</span>");
  });

  it.each(["device", "settings"] as const)(
    "keeps EQ and connect buttons off the %s page",
    (configPage) => {
      for (const connected of [false, true]) {
        const html = renderToStaticMarkup(
          createElement(Header, { ...baseHeaderProps, connected, configPage }),
        );
        expect(html).not.toContain("Read from DAC");
        expect(html).not.toContain("Connect DAC");
        expect(html).not.toContain("Profile:");
        // The Device page card has its own Disconnect.
        expect(html.includes("Disconnect</span>")).toBe(
          connected && configPage === "settings",
        );
      }
    },
  );

  it("marks a saved, edited profile as modified rather than synced", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        connected: true,
        profileSaved: true,
        profileDirty: true,
        deviceMatchesEditor: true,
      }),
    );
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

  it("shows the sync state when connected; the sidebar names the DAC", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        ...baseHeaderProps,
        connected: true,
        deviceMatchesEditor: true,
      }),
    );
    expect(html).toContain("DAC: matches editor");
    expect(html).not.toContain("device-name");
  });
});
