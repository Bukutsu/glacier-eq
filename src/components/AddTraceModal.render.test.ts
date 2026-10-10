import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { OnlineDevice } from "../lib/onlineDb";
import { AddTraceModal } from "./AddTraceModal";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("../lib/onlineDb", () => ({ useOnlineDatabase: () => database }));

const initialDatabase = {
  downloaded: true,
  downloadProgress: null as number | null,
  isDownloading: false,
  manifest: [] as OnlineDevice[],
  loadingManifest: false,
  searchQuery: "",
  setSearchQuery: vi.fn(),
  totalCount: 19508 as number | null,
  loadingDevice: null as string | null,
  download: vi.fn(),
  clearCache: vi.fn(),
  loadDevice: vi.fn(),
};
let database = { ...initialDatabase };

beforeEach(() => { database = { ...initialDatabase }; });
const render = () => renderToStaticMarkup(createElement(AddTraceModal, { onClose: vi.fn(), onAddMeasurement: vi.fn() }));
const measurement = { id: "a", brand: "Sennheiser", name: "HD 600", source: "Test source", price: null };

describe("measurement search modal", () => {
  it("reserves result and status space so changing matches does not recenter the dialog", () => {
    const css = readFileSync(new URL("../styles/tools.css", import.meta.url), "utf8");
    const results = /\.add-trace-online-results\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const status = /\.add-trace-search-status\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(results).toMatch(/^\s*height:\s*min\(/m);
    expect(results).toContain("flex-shrink: 0");
    expect(status).toContain("min-height: 2.8em");
  });

  it("leads with labeled search and keeps import and cache management secondary", () => {
    const html = render();
    expect(html).toContain("Add a curve");
    expect(html).toMatch(/<label[^>]*for="[^"]+">Headphone or brand<\/label>/);
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-describedby=');
    expect(html.indexOf('name="measurement-search"')).toBeLessThan(html.indexOf("add-trace-file-row"));
    expect(html).toContain('<details class="add-trace-cache">');
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it("uses a native result list and clearly named Add buttons", () => {
    database = { ...database, searchQuery: "hd600", manifest: [measurement] };
    const html = render();
    expect(html).toContain("1 measurement found.");
    expect(html).toContain('<ul class="online-result-list"><li');
    expect(html).toContain('aria-label="Add Sennheiser HD 600 measurement"');
    expect(html).toContain("Test source");
    expect(html).toContain("Add</span>");
  });

  it("shows how to recover from a search with no matches", () => {
    database = { ...database, searchQuery: "missing", manifest: [measurement] };
    const html = render();
    expect(html).toContain("No matching measurements.");
    expect(html).toContain("Try a shorter name or check the spelling.");
  });

  it("disables all result actions during a curve load", () => {
    database = { ...database, searchQuery: "hd600", manifest: [measurement], loadingDevice: "a" };
    expect(render()).toMatch(/<button(?=[^>]*online-result-action)(?=[^>]*disabled="")[^>]*>/);
    expect(render()).toContain("Adding…");
  });

  it("explains the database download while keeping file import available", () => {
    database = { ...database, downloaded: false };
    const html = render();
    const searchInput = html.match(/<input[^>]*name="measurement-search"[^>]*>/)?.[0];
    expect(searchInput).toContain('disabled=""');
    expect(html).toContain("Download database");
    expect(html).toContain("Import file");
    expect(html).not.toContain("<details");
  });

  it("shows native download progress", () => {
    database = { ...database, downloaded: false, isDownloading: true, downloadProgress: 0.42 };
    const html = render();
    expect(html).toContain('<progress max="1" value="0.42"');
    expect(html).toContain("Downloading… 42%");
  });
});
