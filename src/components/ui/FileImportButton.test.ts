import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileImportButton } from "./FileImportButton";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isTauri: () => platform.native }));

describe("FileImportButton", () => {
  it("keeps a named web input mounted before opening the picker", () => {
    platform.native = false;
    const html = renderToStaticMarkup(
      createElement(FileImportButton, {
        label: "Import curve",
        accept: ".csv,.txt",
        onImport: () => {},
      }),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('aria-label="Import curve"');
    expect(html).toContain('accept=".csv,.txt"');
    expect(html).toContain('type="button"');
  });
  it("uses only the native picker on Tauri", () => {
    platform.native = true;
    const html = renderToStaticMarkup(
      createElement(FileImportButton, {
        label: "Import curve",
        accept: ".csv,.txt",
        onImport: () => {},
      }),
    );
    expect(html).not.toContain('type="file"');
    expect(html).toContain("Import curve");
  });
});
