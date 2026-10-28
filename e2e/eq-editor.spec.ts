import { expect, test } from "@playwright/test";

test("adding a band updates the band count", async ({ page }) => {
  await page.goto("/");

  const bandsHeader = page.getByRole("button", { name: /Filter bands/ });
  await expect(bandsHeader).toContainText("0/10");

  await page.getByRole("button", { name: "Add band" }).click();

  await expect(bandsHeader).toContainText("1/10");
  await expect(page.getByText("No bands yet. The EQ is flat.")).toBeHidden();
});
