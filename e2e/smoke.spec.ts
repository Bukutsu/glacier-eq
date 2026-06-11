import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Inject mock window.__TAURI_INTERNALS__ before the page loads
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ || {};
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ || {};

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
      {
        name: "Default EQ",
        data: {
          global_gain: 0,
          filters: Array.from({ length: 10 }, (_, i) => ({
            index: i,
            enabled: true,
            filter_type: "Peak",
            freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i],
            gain: 0,
            q: 1.0,
          })),
        },
        modified: null,
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
      global_gain: 0,
      filters: Array.from({ length: 10 }, (_, i) => ({
        index: i,
        enabled: true,
        filter_type: "Peak",
        freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i],
        gain: 0,
        q: 1.0,
      })),
    };
    let settings = { auto_pull_on_connect: true };
    let diagnostics = [
      {
        timestamp: "14:24:00",
        level: "Info" as const,
        source: "UI" as const,
        message: "Application started",
      },
      {
        timestamp: "14:24:05",
        level: "Info" as const,
        source: "HID" as const,
        message: "USB Devices listed successfully",
      },
    ];

    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
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
        case "save_profile":
          if (args && args.name && args.peq) {
            const index = profiles.findIndex((p) => p.name === args.name);
            const newProfile = { name: args.name, data: args.peq, modified: new Date().toISOString() };
            if (index >= 0) {
              profiles[index] = newProfile;
            } else {
              profiles.push(newProfile);
            }
          }
          return null;
        case "delete_profile":
          if (args && args.name) {
            profiles = profiles.filter((p) => p.name !== args.name);
          }
          return null;
        case "get_diagnostics":
          return diagnostics;
        case "clear_diagnostics":
          diagnostics = [];
          return null;
        case "open_profiles_dir":
          return null;
        default:
          if (cmd.startsWith("plugin:event|")) {
            return null;
          }
          throw new Error(`Unhandled mock command: ${cmd}`);
      }
    };

    (window as any).__TAURI_INTERNALS__.transformCallback = (callback: any, once?: boolean) => {
      return Math.floor(Math.random() * 1000000);
    };
    (window as any).__TAURI_INTERNALS__.unregisterCallback = () => {};
    (window as any).__TAURI_INTERNALS__.runCallback = () => {};
    (window as any).__TAURI_INTERNALS__.callbacks = new Map();
  });
});

test("Device chooser and connection flow", async ({ page }) => {
  await page.goto("/");

  // Verify elements on DeviceChooser screen
  await expect(page.locator("h2")).toContainText("Available Devices");
  await expect(page.getByRole("button", { name: /EPZ TP35 Pro/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Glacier Dummy DAC/ })).toBeVisible();

  // Connect to the device
  await page.click("button:has-text('Connect')");

  // Once connected, header should change
  await expect(page.locator(".device-name")).toContainText("EPZ TP35 Pro");
  await expect(page.locator(".app-header")).toBeVisible();

  // Test disconnect button
  await page.click("button:has-text('Disconnect')");

  // Verify we are back to DeviceChooser screen
  await expect(page.locator("h2")).toContainText("Available Devices");
});

test("Dev dummy DAC connects without hardware", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Glacier Dummy DAC/ }).click();
  await page.click("button:has-text('Connect')");

  await expect(page.locator(".device-name")).toContainText("Glacier Dummy DAC");
  await expect(page.locator(".preamp-meta span")).toContainText("-4 dB");
});

test("Modifying EQ bands and preamp", async ({ page }) => {
  await page.goto("/");
  await page.click("button:has-text('Connect')");

  // Verify initial preamp value is 0 dB
  const preampCard = page.locator(".preamp-card");
  await expect(preampCard.locator("strong")).toContainText("Preamp");
  await expect(preampCard.locator(".preamp-meta span")).toContainText("0 dB");

  // Locate the preamp slider and adjust it
  const preampSlider = page.locator(".preamp-card input[type='range']");
  await preampSlider.focus();
  await preampSlider.fill("-5");
  await preampSlider.dispatchEvent("change");

  // Preamp text should update to -5 dB and header show UNSAVED
  await expect(preampCard.locator(".preamp-meta span")).toContainText("-5 dB");
  await expect(page.locator(".unsaved")).toBeVisible();

  // Modify Band 1 freq, Q, and gain
  const bandRows = page.locator(".band-row");
  const firstBand = bandRows.first();

  // Change type to LS (LowShelf)
  await firstBand.locator("button:has-text('LS')").click();
  await expect(firstBand.locator("button:has-text('LS')")).toHaveClass(/selected/);

  // Edit frequency input
  const freqInput = firstBand.locator("input.num-input.freq");
  await freqInput.focus();
  await freqInput.fill("45");
  await freqInput.dispatchEvent("change");
  await expect(freqInput).toHaveValue("45");

  // Edit Q input
  const qInput = firstBand.locator("input.num-input.q");
  await qInput.focus();
  await qInput.fill("0.71");
  await qInput.dispatchEvent("change");
  await expect(qInput).toHaveValue("0.71");

  // Toggle band 1 enabled state (click the band index button)
  const bandIndexBtn = firstBand.locator("button.band-index");
  await expect(bandRows.first()).not.toHaveClass(/muted/);
  await bandIndexBtn.click();
  await expect(bandRows.first()).toHaveClass(/muted/);
});

test("Preset profile management", async ({ page }) => {
  await page.goto("/");
  await page.click("button:has-text('Connect')");

  await expect(page.locator(".history-controls")).toBeVisible();
  await expect(page.locator(".history-btn")).toHaveCount(2);

  // Tab navigation check
  const activeTab = page.locator(".tabs button.active");
  await expect(activeTab).toContainText("Preset");

  // Apply "Sennheiser HD600" profile
  const profileBtn = page.locator(".preset-list button:has-text('Sennheiser HD600')");
  await expect(profileBtn).toBeVisible();
  await profileBtn.click();

  // Active profile in header should update
  await expect(page.locator(".title-line strong")).toContainText("Sennheiser HD600");

  // Search for profiles
  const searchInput = page.locator(".search-row input");
  await searchInput.fill("Default");
  await expect(page.locator(".preset-list button:has-text('Sennheiser HD600')")).not.toBeVisible();
  await expect(page.locator(".preset-list button:has-text('Default EQ')")).toBeVisible();

  // Clear search and create a new profile
  await searchInput.fill("");
  const newNameInput = page.locator("input.new-name");
  await newNameInput.fill("My Custom Preset");

  // Click Save in tool actions
  await page.click("button:has-text('Save')");

  // The new preset should appear in the list and be selected
  await expect(page.locator(".preset-list button:has-text('My Custom Preset')")).toBeVisible();
  await expect(page.locator(".preset-list button:has-text('My Custom Preset')")).toHaveClass(/selected/);

  // Delete the custom preset
  await page.click("button:has-text('Delete')");
  await expect(page.locator(".preset-list button:has-text('My Custom Preset')")).not.toBeVisible();
});

test("Mobile profiles keep history in header and simplify preset actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.click("button:has-text('Connect')");
  await page.click(".mobile-tab-item:has-text('Profiles')");

  await expect(page.locator(".history-controls")).toBeVisible();
  await expect(page.locator(".action-row-primary button")).toHaveCount(3);
  await expect(page.locator(".action-row-primary")).toContainText("Reset");
  await expect(page.locator(".action-row-primary")).toContainText("Save");
  await expect(page.locator(".action-row-primary")).toContainText("Delete");
});

test("Diagnostics panel operations", async ({ page }) => {
  await page.goto("/");
  await page.click("button:has-text('Connect')");

  // Check logs presence
  const logBox = page.locator(".log-box");
  await expect(logBox).toContainText("Application started");
  await expect(logBox).toContainText("USB Devices listed successfully");

  // Clear logs
  await page.click(".diag-head button:has-text('Clear')");
  await expect(logBox).toContainText("No logs yet");
});
