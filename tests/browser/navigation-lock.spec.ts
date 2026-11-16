import { expect, test } from "@playwright/test";

test("locks navigation from Settings and hides the editor entry", async ({ page }) => {
  await page.goto("/settings");
  const navigationSection = page.getByRole("region", { name: "Navigation & sidebar" });

  await expect(
    navigationSection.getByRole("button", { name: "Edit navigation" }),
  ).toBeVisible();
  await navigationSection.getByRole("button", { name: "Lock navigation" }).click();

  await expect(
    navigationSection.getByRole("button", { name: "Unlock navigation" }),
  ).toBeVisible();
  await expect(
    navigationSection.getByRole("button", { name: "Reset navigation" }),
  ).toBeDisabled();
  await expect(
    navigationSection.getByRole("button", { name: "Edit navigation" }),
  ).toHaveCount(0);

  // The lock is saved with the navigation preferences.
  await page.reload();
  await expect(
    navigationSection.getByRole("button", { name: "Unlock navigation" }),
  ).toBeVisible();
  await expect(
    navigationSection.getByRole("button", { name: "Edit navigation" }),
  ).toHaveCount(0);

  await navigationSection.getByRole("button", { name: "Unlock navigation" }).click();
  await expect(
    navigationSection.getByRole("button", { name: "Edit navigation" }),
  ).toBeVisible();
  await expect(
    navigationSection.getByRole("button", { name: "Reset navigation" }),
  ).toBeEnabled();

  await navigationSection.getByRole("button", { name: "Edit navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Edit navigation" })).toBeVisible();
});
