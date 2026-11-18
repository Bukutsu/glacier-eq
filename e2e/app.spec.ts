import { expect, test } from "@playwright/test";

test("loads the EQ workspace without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByText("No bands yet. The EQ is flat.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect DAC" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigates between the main sections", async ({ page }) => {
  await page.goto("/");

  const sections = [
    { link: "Tuning", heading: "Headphone tuning" },
    { link: "Profiles", heading: "Library" },
    { link: "Device", heading: "Offline specifications" },
    { link: "Settings", heading: "Behavior & audio" },
  ];

  for (const { link, heading } of sections) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByText(heading).first()).toBeVisible();
  }
});

test("opens every workspace on a phone-sized screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 400, height: 850 });

  for (const path of ["eq", "tuning", "profiles", "settings", "device/overview"]) {
    await page.goto(`/#/${path}`);
    await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
    await expect(page.getByText("Application error")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
