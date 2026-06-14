import { defineConfig } from '@playwright/test';
import { execSync } from 'child_process';

// Read custom env vars set in ~/.config/fish/config.fish (or your shell rc)
// Example:
//   set -gx PW_CHROMIUM_PATH /usr/bin/chromium
//
// Fallback: uses Playwright's bundled browser if env var is not set
const chromiumPath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  use: {
    baseURL: 'http://localhost:1420',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Use system Chromium via PW_CHROMIUM_PATH env var, or fall back to bundled
        ...(chromiumPath ? {
          launchOptions: { executablePath: chromiumPath },
        } : {}),
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        // System Firefox doesn't work with Playwright (missing Juggler patches).
        // Must use Playwright's bundled Firefox. Run: npx playwright install firefox
      },
    },
  ],
});
