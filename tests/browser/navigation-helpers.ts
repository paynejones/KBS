import { expect, type Locator, type Page } from "@playwright/test";

export async function openNavigationEditor(page: Page): Promise<Locator> {
  await page.goto("/settings");
  await page
    .getByRole("region", { name: "Navigation & sidebar" })
    .getByRole("button", { name: "Edit navigation" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await expect(dialog).toBeVisible();
  return dialog;
}
