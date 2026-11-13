import { expect, test } from "@playwright/test";

test("locks the navigation editor and hides its entry points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Edit navigation" })).toBeVisible();

  await page.getByRole("button", { name: "Edit navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Lock navigation" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unlock navigation editing" })).toBeVisible();

  // The lock is saved with the navigation preferences.
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock navigation editing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit navigation" })).toHaveCount(0);

  await page.getByRole("button", { name: "Unlock navigation editing" }).click();
  await expect(page.getByRole("button", { name: "Edit navigation" })).toBeVisible();

  await page.getByRole("button", { name: "Edit navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Edit navigation" })).toBeVisible();
});
