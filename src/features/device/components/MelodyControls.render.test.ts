import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MelodyControls } from "./MelodyControls";
vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));

describe("SNOWSKY Melody controls", () => {
  function render(resetSlot?: number) {
    return renderToStaticMarkup(
      createElement(MelodyControls, {
        path: "/melody",
        isBusy: false,
        setStatus: vi.fn(),
        onResetEq: resetSlot ? vi.fn() : undefined,
        resetSlot,
      }),
    );
  }
  it("keeps playback controls without duplicating bank selection or rename", () => {
    const html = render();
    expect(html).toContain("EQ preset");
    expect(html).toContain("Choose a preset");
    expect(html).toContain("cannot reliably report its current preset");
    expect(html).not.toContain("Jazz");
    expect(html).not.toContain("Bank to manage");
    expect(html).not.toContain("Slot name");
    expect(html).not.toContain("Refresh settings");
  });
  it("only offers reset for an explicitly selected User bank", () => {
    expect(render()).not.toContain("Reset User");
    expect(render(161)).toContain("Reset User 2 to flat");
  });
});
