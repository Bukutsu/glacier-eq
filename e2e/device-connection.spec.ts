import { expect, test } from "@playwright/test";

test("simulated DAC connects, disconnects and reconnects", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/");
  await page.getByRole("link", { name: "Device" }).first().click();

  const connect = page.getByRole("button", { name: /simulated/i });
  const disconnect = page.getByRole("button", { name: /^disconnect/i });

  for (let round = 0; round < 2; round++) {
    await connect.click();
    await expect(disconnect).toBeVisible();
    await disconnect.click();
    await expect(connect).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("EQ write and read lock the editor while running, then release it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Device" }).first().click();
  await page.getByRole("button", { name: /simulated/i }).click();
  await page.getByRole("link", { name: "EQ", exact: true }).first().click();

  const visible = (name: string) =>
    page.locator("button:visible", { hasText: name }).first();
  await expect(visible("Write to DAC")).toBeEnabled();

  await visible("Write to DAC").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button")
    .last()
    .click();
  await expect(visible("Write to DAC")).toBeDisabled();
  await expect(visible("Write to DAC")).toBeEnabled();

  await visible("Read from DAC").click();
  await expect(visible("Read from DAC")).toBeEnabled();
});
