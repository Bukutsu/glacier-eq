import { chromium, devices } from '@playwright/test';
import { execSync } from 'child_process';

// Simple argument parser
const args = process.argv.slice(2);
const mode = args.includes('--desktop') ? 'desktop' : 'mobile';
const fullPage = args.includes('--full');
const skipConnect = args.includes('--skip-connect');

// Parse --scroll <value>
let scrollY = 0;
const scrollIdx = args.indexOf('--scroll');
if (scrollIdx !== -1 && args[scrollIdx + 1]) {
  scrollY = parseInt(args[scrollIdx + 1], 10);
}

// Parse --filename <value>
let filename = args.includes('--editor') ? `${mode}_editor_ui.png` : `${mode}_ui.png`;
const fileIdx = args.indexOf('--filename');
if (fileIdx !== -1 && args[fileIdx + 1]) {
  filename = args[fileIdx + 1];
}

// Parse --tab <value>
let selectedTab = '';
const tabIdx = args.indexOf('--tab');
if (tabIdx !== -1 && args[tabIdx + 1]) {
  selectedTab = args[tabIdx + 1];
}

const expandFilters = args.includes('--expand-filters');

async function run() {
  console.log(`Launching headless browser in ${mode} mode...`);
  
  const browser = await chromium.launch();
  let contextOptions = {};
  
  if (mode === 'mobile') {
    contextOptions = { ...devices['Pixel 5'] };
  } else {
    contextOptions = { viewport: { width: 1280, height: 800 } };
  }
  
  const context = await browser.newContext(contextOptions);
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
    let devicesList = [
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
          return devicesList;
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
  
  if (!skipConnect) {
    console.log("Page loaded. Clicking Connect button...");
    await page.click("button:has-text('Connect')");
    await page.waitForTimeout(1000);
  }

  if (selectedTab && mode === 'mobile') {
    console.log(`Clicking mobile tab: ${selectedTab}...`);
    const tabNameMap = {
      eq: 'EQ',
      targets: 'Targets',
      profiles: 'Profiles'
    };
    const tabText = tabNameMap[selectedTab.toLowerCase()] || selectedTab;
    await page.click(`.mobile-tab-item:has-text('${tabText}')`);
    await page.waitForTimeout(1000);
  }

  if (expandFilters) {
    console.log("Expanding filters...");
    const header = page.locator('.bands-section-header');
    if (await header.count() > 0) {
      await header.click();
      await page.waitForTimeout(1000);
    }
  }

  // Handle custom scroll position if provided
  if (scrollY > 0) {
    console.log(`Scrolling page by ${scrollY}px...`);
    await page.evaluate((y) => {
      window.scrollTo(0, y);
      // Emulate scrolling on potential scroll containers
      const selectors = ['.main-layout', '.app-container', 'main', '.scroll-container', '.editor-container', '.workspace', 'body', 'html'];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) el.scrollTop = y;
      }
    }, scrollY);
    await page.waitForTimeout(1000);
  }

  console.log("Waiting for rendering...");
  await page.waitForTimeout(1500);

  const screenshotPath = `/home/bukutsu/.gemini/antigravity-cli/brain/570d4eb8-be00-46bd-b107-7679ebf8cbab/${filename}`;
  console.log(`Taking screenshot (fullPage=${fullPage}) and saving to: ${screenshotPath}`);
  await page.screenshot({ path: screenshotPath, fullPage });
  console.log("Screenshot taken successfully!");

  await browser.close();
}

run().catch(console.error);
