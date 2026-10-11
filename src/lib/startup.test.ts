import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { describe, expect, it, vi } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const scan = app.slice(app.indexOf("  const scanDevices = useCallback("), app.indexOf("  useEffect(() => {\n    loadProfiles();"));
const { code } = await transformWithOxc(scan.replaceAll("import.meta.env.DEV", "false"), "scanDevices.ts");

function setup() {
  const scope = {
    useCallback: (fn: unknown) => fn,
    invoke: vi.fn(async () => []),
    setIsBusy: vi.fn(), reportStatus: vi.fn(), setStatus: vi.fn(),
    setDevices: vi.fn(), setSelectedDevice: vi.fn(),
    connectedPathRef: { current: null }, connectedRef: { current: false },
  };
  const scanDevices = new Function(...Object.keys(scope), code + "\nreturn scanDevices;")(
    ...Object.values(scope),
  ) as (blockEditor?: boolean) => Promise<void>;
  return { scope, scanDevices };
}

describe("minimal startup", () => {
  it("discovers devices without locking offline editing", async () => {
    const { scope, scanDevices } = setup();
    await scanDevices(false);
    expect(scope.invoke).toHaveBeenCalledWith("list_devices");
    expect(scope.setIsBusy).not.toHaveBeenCalled();
    expect(scope.setDevices).toHaveBeenCalled();
  });
  it("keeps manual device scans visibly busy", async () => {
    const { scope, scanDevices } = setup();
    await scanDevices();
    expect(scope.setIsBusy.mock.calls).toEqual([[true], [false]]);
  });
  it("still reports background discovery failures", async () => {
    const { scope, scanDevices } = setup();
    scope.invoke.mockRejectedValue(new Error("USB unavailable"));
    await scanDevices(false);
    expect(scope.setStatus).toHaveBeenCalledWith("Failed to scan for devices: Error: USB unavailable");
    expect(scope.setIsBusy).not.toHaveBeenCalled();
  });
  it("uses a logo-only boot shell without onboarding or visible loading text", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toContain('data-theme="tokyo-night"');
    expect(html).toContain('content="#20212b"');
    expect(app).toContain('theme: readBootTheme() ?? "tokyo-night"');
    expect(html).toContain('id="boot-shell"');
    expect(html).toContain('src="/src/bootstrap.ts"');
    expect(html).toContain('boot-theme.js');
    expect(html).not.toContain("<h1>Glacier EQ</h1>");
    expect(html).not.toContain('class="splash"');
    expect(app).not.toContain("glacier-device-onboarding-seen");
    expect(app).not.toContain("Loading tools…");
    expect(app).toContain("void scanDevices(false)");
  });
});
