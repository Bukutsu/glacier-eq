import { chromium, devices } from '@playwright/test';

async function run() {
  console.log("Launching headless browser with mobile emulation...");
  
  const pixel5 = devices['Pixel 5'];
  
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...pixel5,
  });
  const page = await context.newPage();

  // Inject mock window.__TAURI_INTERNALS__ before the page loads
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};

    let connected = false;
    let profiles = [
      {
        name: "Sennheiser HD600",
        data: {
          global_gain: -3,
          filters: Array.from({ length: 10 }, (_, i) => ({
            index: i,
            enabled: i < 3,
            filter_type: "Peak",
            freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i],
            gain: i < 3 ? -2 : 0,
            q: 1.0,
          })),
        },
        modified: "2026-06-11T12:00:00Z",
      },
    ];
    let devices = [
      {
        vendor_id: 0x3302,
        product_id: 0x43e6,
        path: "/dev/hidraw0",
        manufacturer: "EPZ",
        product_string: "TP35 Pro",
        profile_name: "EPZ TP35 Pro",
      },
    ];
    let eqState = {
      global_gain: -3,
      filters: Array.from({ length: 10 }, (_, i) => ({
        index: i,
        enabled: i < 3,
        filter_type: "Peak",
        freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i],
        gain: i < 3 ? -2.5 + i : 0,
        q: 1.0,
      })),
    };
    let settings = { auto_pull_on_connect: true };
    let diagnostics = [
      {
        timestamp: "14:24:00",
        level: "Info",
        source: "UI",
        message: "Application started",
      },
    ];

    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      console.log("Mock IPC invoke:", cmd, args);
      switch (cmd) {
        case "list_profiles":
          return profiles;
        case "list_devices":
          return devices;
        case "connect_device":
          connected = true;
          return null;
        case "disconnect_device":
          connected = false;
          return null;
        case "get_eq_state":
          return eqState;
        case "set_eq_state":
          if (args && args.peq) {
            eqState = args.peq;
          }
          return null;
        case "get_settings":
          return settings;
        case "save_settings":
          if (args && args.settings) {
            settings = args.settings;
          }
          return null;
        case "get_diagnostics":
          return diagnostics;
        default:
          if (cmd.startsWith("plugin:event|")) {
            return null;
          }
          return null;
      }
    };

    window.__TAURI_INTERNALS__.transformCallback = (callback, once) => {
      return Math.floor(Math.random() * 1000000);
    };
    window.__TAURI_INTERNALS__.unregisterCallback = () => {};
    window.__TAURI_INTERNALS__.runCallback = () => {};
    window.__TAURI_INTERNALS__.callbacks = new Map();
  });

  console.log("Navigating to http://localhost:1420...");
  await page.goto("http://localhost:1420", { waitUntil: 'networkidle', timeout: 15000 });
  
  console.log("Page loaded. Clicking Connect button...");
  await page.click("button:has-text('Connect')");

  console.log("Waiting 2 seconds for rendering...");
  await page.waitForTimeout(2000);

  const screenshotPath = '/home/bukutsu/.gemini/antigravity-cli/brain/570d4eb8-be00-46bd-b107-7679ebf8cbab/mobile_editor_ui.png';
  console.log(`Taking screenshot and saving to: ${screenshotPath}`);
  await page.screenshot({ path: screenshotPath });
  console.log("Screenshot taken successfully!");

  await browser.close();
}

run().catch(console.error);
