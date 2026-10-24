import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MelodyBanks } from "./MelodyBanks";
import type { MelodyWorkspace } from "@/features/device/hooks/useMelodyWorkspace";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));

describe("SNOWSKY banks in the profile library", () => {
  it("marks the open bank with a shared badge and leaves its save action in the editor", () => {
    const html = renderToStaticMarkup(
      createElement(MelodyBanks, {
        path: "/melody",
        slots: [160, 161, 162],
        isMelody: true,
        isBusy: false,
        runMaintenance: async () => {},
        onSaveEditor: vi.fn(async () => true),
        workspace: {
          bank: 160,
          switching: false,
          experimental: true,
          enabled: true,
          error: null,
          select: vi.fn(async () => true),
          saveEditorToBank: vi.fn(async () => true),
          beforeExternalChange: vi.fn(async () => true),
          pauseLiveForWrite: vi.fn(async () => {}),
          invalidate: vi.fn(),
          setEnabled: vi.fn(),
        } as unknown as MelodyWorkspace,
      }),
    );
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain("Editing");
    expect(html).toContain('aria-label="Open User 1"');
    expect(html).not.toContain('aria-label="Save current EQ to User 1"');
    expect(html).toContain('aria-label="Save current EQ to User 2"');
    expect(html).toContain("Save changes to store them on the DAC");
  });
});
