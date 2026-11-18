import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const buildPort = 4174;

export default defineConfig({
  testDir: "./e2e",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}` },
    },
    {
      // The hosted build swaps React for Preact, so check the real bundle too.
      // The simulated DAC is dev-only, so device tests stay on the dev server.
      name: "web-build",
      testIgnore: /device-connection/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${buildPort}` },
    },
  ],
  webServer: [
    {
      command: `npm run dev:web -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `vite build --mode web --outDir dist-e2e && vite preview --mode web --outDir dist-e2e --port ${buildPort} --strictPort`,
      url: `http://localhost:${buildPort}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
