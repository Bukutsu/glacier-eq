import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MobileDraftRecovery } from "./MobileDraftRecovery";

function render(
  props: Partial<Parameters<typeof MobileDraftRecovery>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MobileDraftRecovery, {
        invalid: false,
        connected: false,
        isBusy: false,
        onRestore: () => {},
        onDiscard: () => {},
        ...props,
      }),
    ),
  );
}

describe("mobile draft recovery notice", () => {
  it("puts the explanation and recovery actions directly in the workspace", () => {
    const html = render();
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Unfinished EQ");
    expect(html).toContain("Restore EQ");
    expect(html).toContain("Discard draft");
    expect(html).toContain("Nothing is written to your DAC.");
    expect(html).not.toContain("header-draft-trigger");
    expect(html).not.toContain("aria-haspopup");
  });

  it("allows only discard for an unreadable draft", () => {
    const html = render({ invalid: true });
    expect(html).toContain("Unreadable draft");
    expect(html).toContain("Your current EQ stays unchanged.");
    expect(html).toContain("Discard draft");
    expect(html).not.toContain("Restore EQ");
  });

  it("keeps restore disabled while connected and links to Device", () => {
    const html = render({ connected: true });
    expect(html).toContain('href="/device"');
    const buttons = [
      ...html.matchAll(/<button[^>]*>[^<]*([^]*?)<\/button>/g),
    ].map((match) => match[0]);
    expect(buttons.find((button) => button.includes("Restore EQ"))).toContain(
      'disabled=""',
    );
    expect(
      buttons.find((button) => button.includes("Discard draft")),
    ).not.toContain('disabled=""');
  });

  it("disables both recovery actions during device work", () => {
    const html = render({ isBusy: true });
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain('disabled=""');
  });

  it("retains touch-sized actions without needing the full header", () => {
    expect(render()).toContain("min-h-11");
  });
});
